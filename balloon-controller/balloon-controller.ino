#include "TinyGPS++.h"
#include <SPI.h>
#include <SD.h>
#include <LoRa.h>
#include <pins_arduino.h>
#include <Wire.h>
#include <ArduCAM.h>
#include "memorysaver.h"

TinyGPSPlus gps;

//Define pins
const int GPS_LED = LED_BUILTIN;

//Constants
const double STARTING_ELEVATION = 1600; //approx starting elevation in meters
const double THRESHOLD_ELEVATION = STARTING_ELEVATION + 200; //Elevation reqrd to be considered in-flight

const int SD_CONTROL_PIN = 6;
String LOGFILE_NAME = "init.txt";

//Camera constants
#define   FRAMES_NUM    0x01 //number of images to take in a single "burst" minus 1
const int CAMERA_CONTROL_PIN = 7;
ArduCAM myCAM( OV2640, CAMERA_CONTROL_PIN );
bool is_header = false;
const int PICTURE_INTERVAL_MS = 60000;
int nextPictureAt = millis() + 15000;
const int GPS_UPDATE_INTERVAL_MS = 5000;
int nextGpsUpdateAt = millis();

bool isInFlight = false;
bool hasGpsLock = false;

String lat = "0";
String lng = "0";
String alt = "0";

byte gps_set_sucess = 0 ;

void setup() {
  pinMode(GPS_LED, OUTPUT);
  digitalWrite(GPS_LED, LOW);
  
  Serial.begin(9600);
  Serial1.begin(9600);

  //Initialize LoRa module
  if (!LoRa.begin(915E6)) {
    Serial.println("Starting LoRa failed!");
    while (1);
  }
  
  LoRa.setTxPower(20);
  LoRa.setSpreadingFactor(11);
  LoRa.setSignalBandwidth(250E3);

  //Initialize SD Card
  Serial.println("Initializing SD card...");
  if (!SD.begin(SD_CONTROL_PIN)) {
    Serial.println("SD initialization failed. Cannot continue.");
    sendLora("SD initialization failed. Cannot continue.");
    
    // don't do anything more:
    while (1);
  }

  logInfo("--------------NEW RUN----------------");

  //Initialize GPS
  logInfo("GPS starting");
//  setGPS_Airborne();
  logInfo("GPS setup Complete, waiting for GPS lock...");

  //Initialize Camera
  setupCamera();
  logInfo("Camera setup complete.");
}

void loop() {
  //Read in new gps data
  while(Serial1.available() > 0){
    gps.encode(Serial1.read());
  }

  if(gps.location.isUpdated()){
    if(gps.satellites.value() >= 4){
      if(!hasGpsLock){ // If satallite lock just became availible
        hasGpsLock = true;
        digitalWrite(GPS_LED, HIGH);
        logInfo("Aquired lock");
        if(LOGFILE_NAME == "init.txt"){
          LOGFILE_NAME = formatTime(gps.time.hour()) + formatTime(gps.time.minute()) + formatTime(gps.time.second()) + ".txt";
          logInfo("Lock aquired. New logfile created for trip.");
        }
      }
    }else{
      if(hasGpsLock){
        hasGpsLock = false;
        digitalWrite(GPS_LED, LOW);
        logInfo("LOST Lock.");
      }
    }

    lat = String(gps.location.lat(),6);
    lng = String(gps.location.lng(),6);
    alt = String(gps.altitude.meters());
  }

  //Transmit gps location
  if(millis() > nextGpsUpdateAt){
    logInfo("GPS|" + lat + "," + lng + "," + alt);
    nextGpsUpdateAt = millis() + GPS_UPDATE_INTERVAL_MS;
  }

  //Wake up camera 10 seconds before picture 
  if(millis() > nextPictureAt - 10000){
    myCAM.clear_bit(ARDUCHIP_GPIO,GPIO_PWDN_MASK);
  }
  
  //Take a picture
  if(millis() > nextPictureAt){
    takePicture();
    nextPictureAt = millis() + PICTURE_INTERVAL_MS;
  }

}




void setGPS_Airborne()
{
  Serial.println("Setting uBlox nav mode: ");
  uint8_t setNav[] = {
    0xB5, 0x62, 0x06, 0x24, 0x24, 0x00, 0xFF, 0xFF, 0x06, 0x03, 0x00, 0x00, 0x00, 0x00, 0x10, 0x27, 0x00, 0x00,
    0x05, 0x00, 0xFA, 0x00, 0xFA, 0x00, 0x64, 0x00, 0x2C, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0xDC };
  while(!gps_set_sucess)
  {
    sendUBX(setNav, sizeof(setNav)/sizeof(uint8_t));
    gps_set_sucess=getUBX_ACK(setNav);
  }
  gps_set_sucess=0;
}

void setGPS_Portable()
{
 int gps_set_sucess=0;
 uint8_t setdm6[] = {
 0xB5, 0x62, 0x06, 0x24, 0x24, 0x00, 0xFF, 0xFF, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0x10, 0x27,
0x00, 0x00, 0x05, 0x00, 0xFA, 0x00, 0xFA, 0x00, 0x64, 0x00, 0x2C, 0x01, 0x00, 0x3C, 0x00, 0x00,
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x4C, 0x1C };
 while(!gps_set_sucess)
 {
  sendUBX(setdm6, sizeof(setdm6)/sizeof(uint8_t));
  gps_set_sucess=getUBX_ACK(setdm6);
 }
}

void sendUBX(uint8_t *MSG, uint8_t len) {
  Serial1.write(MSG, len);
//  for(int i=0; i<len; i++) {
//    Serial1.write(MSG[i]);
//  }
  Serial1.println();
}

boolean getUBX_ACK(uint8_t *MSG) {
  uint8_t b;
  uint8_t ackByteID = 0;
  uint8_t ackPacket[10];
  unsigned long startTime = millis();
  Serial.print(" * Reading ACK response: ");
 
  // Construct the expected ACK packet    
  ackPacket[0] = 0xB5;  // header
  ackPacket[1] = 0x62;  // header
  ackPacket[2] = 0x05;  // class
  ackPacket[3] = 0x01;  // id
  ackPacket[4] = 0x02;  // length
  ackPacket[5] = 0x00;
  ackPacket[6] = MSG[2];  // ACK class
  ackPacket[7] = MSG[3];  // ACK id
  ackPacket[8] = 0;   // CK_A
  ackPacket[9] = 0;   // CK_B
 
  // Calculate the checksums
  for (uint8_t i=2; i<8; i++) {
    ackPacket[8] = ackPacket[8] + ackPacket[i];
    ackPacket[9] = ackPacket[9] + ackPacket[8];
  }
 
  while (1) {
 
    // Test for success
    if (ackByteID > 9) {
      // All packets in order!
      Serial.println(" (SUCCESS!)");
      return true;
    }
 
    // Timeout if no valid response in 3 seconds
    if (millis() - startTime > 3000) { 
      Serial.println(" (FAILED!)");
      return false;
    }
 
    // Make sure data is available to read
    if (Serial1.available()) {
      b = Serial1.read();
      
 
      // Check that bytes arrive in sequence as per expected ACK packet
      if (b == ackPacket[ackByteID]) { 
        ackByteID++;
        Serial.print(b, HEX);
      } 
      else {
        ackByteID = 0;  // Reset and look again, invalid order
      }
 
    }
  }
}

void setupCamera(){
  uint8_t vid, pid;
  uint8_t temp;
  
   #if defined(__SAM3X8E__)
      Wire1.begin();
   #else
      Wire.begin();
   #endif
   
   pinMode(CAMERA_CONTROL_PIN, OUTPUT);
   digitalWrite(CAMERA_CONTROL_PIN, HIGH);

   // initialize SPI:
  SPI.begin();
  
  //Reset the CPLD
  myCAM.write_reg(0x07, 0x80);
  delay(100);
  myCAM.write_reg(0x07, 0x00);
  delay(100);
  while (1) {
    //Check if the ArduCAM SPI bus is OK
    myCAM.write_reg(ARDUCHIP_TEST1, 0x55);
    temp = myCAM.read_reg(ARDUCHIP_TEST1);
    if (temp != 0x55)
    {
      logInfo("Camera SPI interface Error!");
      delay(1000); continue;
    } else {
      logInfo("Camera SPI interface OK.");
      break;
    }
  }

  //Change to JPEG capture mode and initialize the OV2640 module
  myCAM.set_format(JPEG);
  myCAM.InitCAM();
  myCAM.clear_fifo_flag();
  myCAM.write_reg(ARDUCHIP_FRAMES, FRAMES_NUM);
  myCAM.OV2640_set_JPEG_size(OV2640_1600x1200);
}

void takePicture(){
  logInfo("Image capture requested");

  myCAM.clear_bit(ARDUCHIP_GPIO,GPIO_PWDN_MASK);
  
  myCAM.flush_fifo();
  myCAM.clear_fifo_flag();

  myCAM.start_capture();  
  Serial.println("Before get bit");
  while ( !myCAM.get_bit(ARDUCHIP_TRIG, CAP_DONE_MASK));
  Serial.println("After get bit");
  read_fifo_burst(myCAM);

  // Put camera back into low power mode
  myCAM.set_bit(ARDUCHIP_GPIO,GPIO_PWDN_MASK);
}

uint8_t read_fifo_burst(ArduCAM myCAM)
{
  uint8_t temp = 0, temp_last = 0;
  uint32_t length = 0;
  static int i = 0;
  static int k = 0;
  String str;
  File outFile;
  byte buf[256];
  length = myCAM.read_fifo_length();
  Serial.print(F("The fifo length is :"));
  Serial.println(length, DEC);
  if (length >= MAX_FIFO_SIZE) //8M
  {
    logInfo("Image over size.");
    return 0;
  }
  if (length == 0 ) //0 kb
  {
    logInfo("Image size is 0.");
    return 0;
  }
  myCAM.CS_LOW();
  myCAM.set_fifo_burst();//Set fifo burst mode
  i = 0;
  while ( length-- )
  {
    temp_last = temp;
    temp =  SPI.transfer(0x00);
    //Read JPEG data from FIFO
    if ( (temp == 0xD9) && (temp_last == 0xFF) ) //If find the end ,break while,
    {
      buf[i++] = temp;  //save the last  0XD9
      //Write the remain bytes in the buffer
      myCAM.CS_HIGH();
      outFile.write(buf, i);
      //Close the file
      outFile.close();
      Serial.println(F("OK"));
      is_header = false;
      myCAM.CS_LOW();
      myCAM.set_fifo_burst();
      i = 0;
    }
    if (is_header == true)
    {
      //Write image data to buffer if not full
      if (i < 256)
        buf[i++] = temp;
      else
      {
        //Write 256 bytes image data to file
        myCAM.CS_HIGH();
        outFile.write(buf, 256);
        i = 0;
        buf[i++] = temp;
        myCAM.CS_LOW();
        myCAM.set_fifo_burst();
      }
    }
    else if ((temp == 0xD8) & (temp_last == 0xFF))
    {
      is_header = true;
      myCAM.CS_HIGH();
      //Create a avi file
      k = k + 1;
      //Save image name with date
      str = formatTime(gps.time.hour()) + formatTime(gps.time.minute()) + formatTime(gps.time.second()) + ".jpg";

      if(str == "000000.jpg"){
        str = String(k) + ".jpg";
      }
      //Open the new file
      
      if(!SD.exists("INIT.txt")){
        logInfo("Unable to open image file");
        break;
      }

      outFile = SD.open(str, FILE_WRITE);
      if(!outFile){
        logInfo("Unable to open image file");
        break;
      }
      
      myCAM.CS_LOW();
      myCAM.set_fifo_burst();
      buf[i++] = temp_last;
      buf[i++] = temp;
    }
  }
  myCAM.CS_HIGH();
  return 1;
}

void logInfo(String msg){
  if(msg.indexOf("GPS") < 0){
    msg = "MSG|" + msg;
  }
  sendLora(msg);
  
  String buf = "";
  buf += String(gps.date.value()) + " " + String(gps.time.value()) + " " + msg;

  Serial.println(buf);
  
  File dataFile = SD.open(LOGFILE_NAME, FILE_WRITE);
  if(SD.exists("INIT.txt")){
    dataFile.println(buf);
    dataFile.close();
  }
  
}

void sendLora(String msg){
  LoRa.beginPacket();
  LoRa.println(msg);
  LoRa.endPacket();
}

String formatTime(int time){
  String timeString = String(time);
  if(timeString.length() > 1){
    return timeString;
  }
  return "0" + timeString;
}
