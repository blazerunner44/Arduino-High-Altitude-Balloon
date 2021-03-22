#include <SPI.h>
#include <LoRa.h>
#include <SD.h>

char temp;
bool sdEnabled = false;

const String LOGFILE_NAME = "log.txt";
const int STATUS_LED_PIN = 2;

void setup() {
  pinMode(STATUS_LED_PIN, OUTPUT);

//  while(!Serial);
  Serial.begin(9600);

  #if !defined(ARDUINO_SAMD_MKRWAN1300) && !defined(ARDUINO_SAMD_MKRWAN1310)
    // Using a Semtech SX1276 module instead of built into the arduino
    const int ss = 6;
    const int reset = 7;
    const int dio0 = 3;
    LoRa.setPins(ss, reset, dio0);
  #endif

  #if defined(ARDUINO_SAMD_MKRZERO)
   // Use the builtin SD card slot on the MKR Zero board
   const int SD_CONTROL_PIN = SDCARD_SS_PIN;
  #else
    const int SD_CONTROL_PIN = 1;
  #endif

  if (SD.begin(SD_CONTROL_PIN)) {
    sdEnabled = true;
  }

  if (!LoRa.begin(915E6)) {
    Serial.println("Starting LoRa failed!");
    while (1);
  }

  LoRa.setSpreadingFactor(11);
  LoRa.setSignalBandwidth(250E3);
}

void loop() {
  // try to parse packet
  int packetSize = LoRa.parsePacket();
  if (packetSize) {
    // read packet
    String buff = "";
    while (LoRa.available()) {
      temp = (char)LoRa.read();
      buff += temp;
      
      Serial.print(temp);
      digitalWrite(STATUS_LED_PIN, HIGH);
    }

    if(sdEnabled){
      //Write data to SD card
      File dataFile = SD.open(LOGFILE_NAME, FILE_WRITE);
      if(dataFile){
        dataFile.println(buff);
        dataFile.close();
      }
    }
  }
}
