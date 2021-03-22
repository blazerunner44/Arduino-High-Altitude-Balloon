const http = require('http');

const hostname = '127.0.0.1';
const servicePort = 3000;

const SerialPort = require('serialport');
const Readline = require('@serialport/parser-readline');

const args = process.argv.slice(2);

require('dotenv').config();

if(args.length == 0){
  console.log("Please provide a COM port as a command line argument.");
  console.log("ex. node app.js COM3");
  return;
}
const port = new SerialPort(args[0], { baudRate: 9600 });
const parser = port.pipe(new Readline({ delimiter: '\n' }));
// Read the port data
port.on("open", () => {
  console.log('Serial port opened');
  console.log("Waiting to receive data...")
});
parser.on('data', data =>{
  if(clientSocket != undefined){
    clientSocket.emit('rawConsoleUpdate', data);
  }

  console.log(data);
  
  if(data.indexOf("GPS") > -1 && isASCII(data)){
    let gpsCords = data.split("|")[1];
    if(gpsCords == undefined){
      console.log("bad data: " + data);
      sendMsgUpdate(data);
    	return;
    }
    gpsCords = gpsCords.split(",");
    if(gpsCords.length != 3){
      //Bad data
      console.log("bad data: " + data);
      sendMsgUpdate(data);
      return;
    }

    if(gpsCords[0] == "0"){ //This means the balloon GPS hasn't gotten a position fix, skip the message
    	return; 
    }

    if(isNaN(gpsCords[0]) || isNaN(gpsCords[1]) || isNaN(gpsCords[2])){
      console.log("bad data: " + data);
      sendMsgUpdate(data);
      return;
    }

    let gpsUpdate = {'timestamp': Date.now()};
    gpsUpdate.lat = parseFloat(gpsCords[0]);
    gpsUpdate.lng = parseFloat(gpsCords[1]);
    gpsUpdate.alt = parseFloat(gpsCords[2]);

   	sendGpsUpdate(gpsUpdate);
  }else{
    sendMsgUpdate(data);
  }
  
});

var clientSocket = undefined;

var httpServer = http.createServer(function (req, res) {
    var reqpath = req.url.toString().split('?')[0];

    var file = __dirname + reqpath.replace(/\/$/, '/index.html');
    
    if(file.includes('.html')){
      var type = 'text/html';
    }
    if(file.includes('.js')){
      var type = 'application/javascript';
    }
    if(file.includes('.png')){
      var type = 'image/png';
    }

    var s = require('fs').createReadStream(file);
    s.on('open', function () {
        res.setHeader('Content-Type', type);
        s.pipe(res);
    });
    s.on('error', function () {
        res.setHeader('Content-Type', 'text/plain');
        res.statusCode = 404;
        res.end('Not found');
    });
});

const io = require('socket.io')(httpServer, { origins: '*:*'});

io.on('connect', socket => {
  console.log('Web interface attached');
  clientSocket = socket;
});

httpServer.listen(servicePort, () => {
  console.log('Balloon receiver initialized. Access the receiver monitor at http://localhost:3000');
});


// This is the code to connect to the remote server
var serverSocket = require("socket.io-client")(process.env.HOST + ':' + process.env.PORT);
serverSocket.on('connect', function () {
  console.log("Connected to flight server.");
});


function sendGpsUpdate(gpsUpdate){
  serverSocket.emit('receivedGpsUpdate', gpsUpdate);
}

function sendMsgUpdate(data){
  serverSocket.emit('receivedMsgUpdate', {'timestamp': Date.now(), 'message': data});
}

function isASCII(str) {
    return /^[\x00-\x7F]*$/.test(str);
}