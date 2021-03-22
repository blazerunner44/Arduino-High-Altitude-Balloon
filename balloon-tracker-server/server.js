const args = process.argv.slice(2);

const http = require('http');
const https = require('https');
const { parse } = require('querystring');

require('dotenv').config();

const hostname = 'blazerunner44.me';
const servicePort = 3000;

const mysql = require('mysql');
const connection = mysql.createPool({
  host: process.env.HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
});

var currentGroundSpeed = 0;
var currentAltDelta = 0;
var lastPayloadLocation = undefined;

var descAltPointCount = 0;
var ascAltPointCount = 0;
var determinedBurstPoint = undefined;
var burstAltFound = false;

if(args[0] == "reset"){
  connection.query("DELETE FROM flightpaths");
  connection.query("DELETE FROM gpsUpdates");
  connection.query("DELETE FROM msgUpdates");
  console.log("Deleting all data...");
  return;
}

//HTTPS Server Stuff
const httpsOptions = {
  cert: require('fs').readFileSync(process.env.PATH_TO_SSL_CERT),
  key: require('fs').readFileSync(process.env.PATH_TO_SSL_KEY),
  ca: require('fs').readFileSync(process.env.PATH_TO_SSL_CA)
};

const httpsServer = require('https').createServer(httpsOptions, (req, res) => {
  if(req.method == "POST"){
    //This is a phone sending us a GPS update. We're going to broadcast it out to all the clients. 
    collectRequestData(req, result => {
      console.log(result);
        if(result.lat != undefined && result.lon != undefined){

          let update = {};
          update.id = result.tid;
          update.lat = parseFloat(result.lat);
          update.lng = parseFloat(result.lon);
          update.speed = (result.vel != undefined ? parseFloat(result.vel) / 1.609 : 0); //Convert from kmh to mph
          update.date = new Date();

          console.log("updated");

          io.sockets.emit('receivedReceiverLocationUpdate', update);
        }
        res.statusCode = 200;
        res.end();
    });
  }else{
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Balloon tracking server');
  }
}).listen(servicePort, () => {
  console.log('Balloon tracking server started on http://' + hostname + ':' + servicePort);
});

//Check if previous burst altitude has already been stored
connection.query("SELECT * FROM gpsUpdates WHERE burst=1 ORDER BY timestamp DESC LIMIT 1", (err, row) => {
  if(err){
    throw err;
  }

  if(row.length == 0) return;

  if(row.length != 1){
    console.log("Error finding saved burst point.");
    return;
  }
  row = row[0];
  burstAltFound = true;
  lastKnownAltitude = row.alt;

  determinedBurstPoint = row;
  determinedBurstPoint.lat = parseFloat(row.lat);
  determinedBurstPoint.lng = parseFloat(row.lng);
  
  io.sockets.emit('burstUpdate', determinedBurstPoint);
});

//Check for previous last payload location
connection.query("SELECT * FROM gpsUpdates ORDER BY timestamp DESC LIMIT 1", (err, row) => {
  if(err){
    throw err;
  }

  if(row.length == 0) return;

  row = row[0];
  
  lastPayloadLocation = row;
  lastPayloadLocation.lat = parseFloat(row.lat);
  lastPayloadLocation.lng = parseFloat(row.lng);
  
  io.sockets.emit('receivedGpsUpdate', lastPayloadLocation);
});

const io = require('socket.io')(httpsServer);

io.on('connect', socket => {
  console.log("New balloon client connected.");

  //Get client up to speed on what's happened
  socket.emit('altDeltaUpdate', currentAltDelta);
  socket.emit('currentGroundSpeed', currentGroundSpeed);
  socket.emit('receivedGpsUpdate', lastPayloadLocation);
  getFlightHistory().then(flightHistory => {
    if(flightHistory.length > 0){
      socket.emit('receivedFlightHistory', flightHistory);
    }
  });
  getFlightpathPrediction().then(flightPrediction => {
    socket.emit('updateFlightpath', flightPrediction);
  });
  if(burstAltFound){
    socket.emit('burstUpdate', determinedBurstPoint);
  }

  socket.on('receivedMsgUpdate', msgUpdate => {
    msgUpdate.timestamp = (msgUpdate.timestamp-(msgUpdate.timestamp%1000))/1000;

    connection.query("INSERT INTO msgUpdates SET message='" + connection.escape(msgUpdate.message) + "',timestamp=from_unixtime(" + connection.escape(msgUpdate.timestamp) + ")", (err, rows) => {
      if(err && err.sqlMessage.indexOf("Duplicate") < 0){
        console.log(err);
      }
    });
  });

  socket.on('receivedGpsUpdate', gpsUpdate => {

    //Determine if this is a valid update (moving less than 50 mph)
    if(lastPayloadLocation != undefined){
      let distanceDelta = getDistanceBetween(gpsUpdate, lastPayloadLocation);
      let timeSecondsDelta = Math.abs(gpsUpdate.timestamp - lastPayloadLocation.timestamp) / 1000;
      let milesPerHour = (distanceDelta/timeSecondsDelta) * 3600;

      if(milesPerHour > 50){
        return;
      }
    }


    io.sockets.emit('receivedGpsUpdate', gpsUpdate);
    
    //Determine the burst altitude
    if(!burstAltFound && gpsUpdate.timestamp > lastPayloadLocation.timestamp && gpsUpdate.alt + 2 < lastPayloadLocation.alt){
      if (descAltPointCount == 0) {
        determinedBurstPoint = gpsUpdate;
      }
      descAltPointCount++;
      ascAltPointCount = 0;

      if (descAltPointCount >= 10) {
        burstAltFound = true;
        console.log("Burst alt found at " + determinedBurstPoint.alt);
        io.sockets.emit('burstUpdate', determinedBurstPoint);

        connection.query("UPDATE gpsUpdates SET burst=1 WHERE timestamp = FROM_UNIXTIME(" + dateToDbFormat(determinedBurstPoint.timestamp) + ")");
      }
    }else{
      ascAltPointCount++;
      if(ascAltPointCount >= 3){
        ascAltPointCount = 0;
        descAltPointCount = 0;
        determinedBurstPoint = undefined;
      }
    }

    //Gps updates may not come in sequential order (if a client is disconnected temporarily)
    if(gpsUpdate.timestamp > lastPayloadLocation.timestamp || lastPayloadLocation == undefined){
      lastPayloadLocation = gpsUpdate;
    }

    connection.query("INSERT INTO gpsUpdates (timestamp, lat, lng, alt) VALUES (FROM_UNIXTIME(" + dateToDbFormat(gpsUpdate.timestamp) + '),"' + connection.escape(gpsUpdate.lat) + '","' + connection.escape(gpsUpdate.lng) + '",' + connection.escape(gpsUpdate.alt) + ")", (err, rows) => {
      if(err && err.sqlMessage.indexOf("Duplicate") < 0){
        console.log(err);
      }
    })
  });
});

// Generate a new flight path every 5 minutes
setInterval(function(){
  getAltDelta().then(altDelta => {
    connection.query("SELECT * FROM gpsUpdates ORDER BY timestamp DESC LIMIT 1", (err, lastGpsUpdate) => {
      if(lastGpsUpdate.length < 1){
        console.log("Unable to get flight prediction: No recent GPS coordinates.");
        return;
      }
      if(altDelta == 0){
        console.log("Unable to get flight prediction: No asc/desc data.");
        return;
      }


      lastGpsUpdate = lastGpsUpdate[0];

      // console.log('https://predict.cusf.co.uk/api/v1/?' + 
      //   'launch_latitude=' + (parseFloat(lastGpsUpdate.lat) < 0 ? parseFloat(lastGpsUpdate.lat)+360 : lastGpsUpdate.lat) + 
      //   '&launch_longitude=' + (parseFloat(lastGpsUpdate.lng) < 0 ? parseFloat(lastGpsUpdate.lng)+360 : lastGpsUpdate.lng) + 
      //   '&launch_altitude=' + lastGpsUpdate.alt + 
      //   '&launch_datetime=' + lastGpsUpdate.timestamp.toISOString() + 
      //   '&ascent_rate=' + (burstAltFound ? 5 : Math.abs(altDelta)) + 
      //   '&burst_altitude=' + (burstAltFound ? lastGpsUpdate.alt + 1 : 30000) + 
      //   '&descent_rate=' + (burstAltFound ? Math.abs(altDelta) : 5));
      https.get('https://predict.cusf.co.uk/api/v1/?' + 
        'launch_latitude=' + (parseFloat(lastGpsUpdate.lat) < 0 ? parseFloat(lastGpsUpdate.lat)+360 : lastGpsUpdate.lat) + 
        '&launch_longitude=' + (parseFloat(lastGpsUpdate.lng) < 0 ? parseFloat(lastGpsUpdate.lng)+360 : lastGpsUpdate.lng) + 
        '&launch_altitude=' + lastGpsUpdate.alt + 
        '&launch_datetime=' + lastGpsUpdate.timestamp.toISOString() + 
        '&ascent_rate=' + (burstAltFound ? 5 : Math.abs(altDelta)) + 
        '&burst_altitude=' + (burstAltFound ? lastGpsUpdate.alt + 1 : 30000) + 
        '&descent_rate=' + (burstAltFound ? Math.abs(altDelta) : 5)
        , resp => {
          let data = '';

          // A chunk of data has been recieved.
          resp.on('data', (chunk) => {
            data += chunk;
          });

          // The whole response has been received. Print out the result.
          resp.on('end', () => {
            response = JSON.parse(data);
            if(response == undefined){
              console.log("Unable to get flight prediction. No response received.");
              return;
            }

            if(response.hasOwnProperty('error')){
              console.log("Unable to get flight prediction: " + (response.error.hasOwnProperty('description') ? response.error.description : "No description" ));
              return;
            }

            let flightpathData = [];
            //Save flight prediction data to database
            connection.query("INSERT INTO flightpaths (launch_datetime, ascent_rate, descent_rate, launch_lat, launch_lng, launch_alt, burst_alt) VALUES ('" + response.request.launch_datetime + "', " + response.request.ascent_rate + ", " + response.request.descent_rate + ", '" + response.request.launch_latitude + "', '" + response.request.launch_longitude + "', " + response.request.launch_altitude + ", " + response.request.burst_altitude + ")", (err, ack) => {
              if(err) {
                console.log(err);
                return;
              }

              let flightpathId = ack.insertId;

              //Insert predictions into the database
              for (var i = 0; i < response.prediction.length; i++) {
                if(response.prediction[i].trajectory.length < 3){
                  continue;
                }

                for (var j = 0; j < response.prediction[i].trajectory.length; j++) {
                  let prediction = response.prediction[i].trajectory[j];
                  prediction.longitude = prediction.longitude-360;

                  //Add to the data we'll send back to the client
                  flightpathData.push({
                    lat: prediction.latitude,
                    lng: prediction.longitude
                  });

                  connection.query("INSERT INTO flightpathPredictions (lat, lng, alt, expected_time, decent, flightpath) VALUES ('" + prediction.latitude + "', '" + prediction.longitude + "', " + prediction.altitude + ", '" + prediction.datetime + "', " + (response.prediction[i].stage == "descent" ? 1 : 0 ) + ", " + flightpathId + ")", (err, ack) => {
                    if(err) console.log(err)
                  });
                }
              }

              //Send flightpath to the clients
              io.sockets.emit('updateFlightpath', flightpathData);
            })
          });


        })
    })
    
  });
}, 200000);

//Send alt delta updates every 15 seconds
setInterval(function(){
  getAltDelta().then(altDelta => {
    io.sockets.emit('altDeltaUpdate', (isNaN(altDelta) ? 0 : altDelta));
  })
}, 15000);

//Send speed delta updates every 15 seconds
setInterval(function(){
  getGroundSpeed().then(groundSpeed => {
    io.sockets.emit('groundSpeedUpdate', (isNaN(groundSpeed) ? 0 : groundSpeed));
  })
}, 15000);


function getAltDelta(period = 30){
  var metersPerSecondReadingTotal = 0;
  var metersPerSecondReadingCount = 0;
  const promise = new Promise((resolve, reject) => {
    connection.query("SELECT * FROM gpsUpdates WHERE timestamp > (now() - INTERVAL " + period + " SECOND) ORDER BY timestamp", (err, rows) => {
      for (var i = 0; i < rows.length; i++) {
        if(i==0){
          continue;
        }
        altDelta = rows[i].alt - rows[i-1].alt;
        timeSecondsDelta = Math.abs(rows[i].timestamp - rows[i-1].timestamp) / 1000;

        metersPerSecondReadingTotal += (altDelta/timeSecondsDelta);
        metersPerSecondReadingCount++;
      }
      currentAltDelta = (metersPerSecondReadingTotal/metersPerSecondReadingCount).toFixed(2);
      currentAltDelta = (isNaN(currentAltDelta) ? 0 : currentAltDelta);
      resolve( currentAltDelta );
    });
  });

  return promise;
}

function getGroundSpeed(period = 30){
  var milesPerHourReadingTotal = 0;
  var milesPerHourReadingCount = 0;
  const promise = new Promise((resolve, reject) => {
    connection.query("SELECT * FROM gpsUpdates WHERE timestamp > (now() - INTERVAL " + period + " SECOND) ORDER BY timestamp", (err, rows) => {
      for (var i = 0; i < rows.length; i++) {
        if(i==0){
          continue;
        }
        distanceDelta = getDistanceBetween(rows[i], rows[i-1]);
        timeSecondsDelta = Math.abs(rows[i].timestamp - rows[i-1].timestamp) / 1000;

        milesPerHourReadingTotal += (distanceDelta/timeSecondsDelta) * 3600;
        milesPerHourReadingCount++;
      }
      currentGroundSpeed = (milesPerHourReadingTotal/milesPerHourReadingCount).toFixed(2);
      resolve( currentGroundSpeed );
    });
  });

  return promise;
}

function getFlightHistory(){
  var flightHistory = [];
  const promise = new Promise((resolve, reject) => {
    connection.query("SELECT * FROM gpsUpdates ORDER BY timestamp", (err, rows) => {
      for (var i = 0; i < rows.length; i++) {
        flightHistory.push({
          lat: parseFloat(rows[i].lat),
          lng: parseFloat(rows[i].lng),
          alt: rows[i].alt
        });
      }
      
      resolve( flightHistory );
    });
  });

  return promise;
}

function getFlightpathPrediction(){
  const promise = new Promise((resolve, reject) => {
    connection.query("SELECT id FROM flightpaths ORDER BY launch_datetime DESC LIMIT 1", (err, flightpathRow) => {
      if(err) throw err;

      if(flightpathRow.length != 1) return;
      flightpathRow = flightpathRow[0];

      var flightpath = [];

      connection.query("SELECT lat,lng,alt FROM flightpathPredictions WHERE flightpath=" + flightpathRow.id + " ORDER BY expected_time", (err, rows) => {
        for (var i = 0; i < rows.length; i++) {
          flightpath.push({
            lat: parseFloat(rows[i].lat),
            lng: parseFloat(rows[i].lng),
            alt: rows[i].alt
          });
        }
        resolve( flightpath );
      });
      
    });
  });

  return promise;
}

function getDistanceBetween(point1, point2) {
  var R = 3958.8; // Radius of the earth in mi
  var dLat = (Math.PI/180) * (point2.lat-point1.lat);
  var dLon = (Math.PI/180) * (point2.lng-point1.lng); 
  var a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos((Math.PI/180) * (point1.lat)) * Math.cos((Math.PI/180) * (point2.lat)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
    ; 
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  var d = R * c; // Distance in km
  return d;
}

function collectRequestData(request, callback) {
    const FORM_URLENCODED = 'application/x-www-form-urlencoded';
    // if(request.headers['content-type'] === FORM_URLENCODED) {
        let body = '';
        request.on('data', chunk => {
            body += chunk.toString();
        });
        request.on('end', () => {
            callback(JSON.parse(body));
        });
    // }
    // else {
        // callback(null);
    // }
}

function dateToDbFormat(date){
  return (date-(date%1000))/1000;
}