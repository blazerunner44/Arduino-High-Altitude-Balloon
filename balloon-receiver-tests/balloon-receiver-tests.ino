#include <SPI.h>
#include <LoRa.h>

char temp;

const int MAX_ALTITUDE = 2850;
const int MIN_ALTITUDE = 2300;
float ascRate = 4.25;
float altitude = 2500;
float latIncRate = 0.000001;
float lngIncRate = 0.000001;

float latValue = 41.752701;
float lngValue = -111.806918;

void setup() {
  Serial.begin(9600);
  while (!Serial);

  Serial.println("LoRa Receiver");

  if (!LoRa.begin(915E6)) {
    Serial.println("Starting LoRa failed!");
    while (1);
  }

  LoRa.setSpreadingFactor(11);
  LoRa.setSignalBandwidth(250E3);

  //Test garbage data
  Serial.println("GP���1�715�67,-=11.X�6310�9376.�2");
  delay(1000);
  Serial.println("GPSz41.725467,(111.863101376,39");
  delay(1000);

  //Test non-numeric coordinates
  Serial.println("GPS|41.7er4685,-111.810544,99999.00");
  delay(1000);
  Serial.println("GPS|41.704685,-111.81ee544,99999.00");
  delay(1000);

  //Test quote ascii characters
  Serial.println("GPS|41.74685',-111.810544,99999.00");
  delay(1000);
  Serial.println("GPS|41.704685,-111.81\"544,99999.00");
  delay(1000);
  
  //Test coordinates too far away
  Serial.print("GPS|");
  Serial.print(latValue, 6);
  Serial.print(",");
  Serial.print(lngValue, 6);
  Serial.print(",");
  Serial.print(altitude, 2);
  Serial.println("");
  
  delay(1000);
  
  Serial.print("GPS|");
  Serial.print(latValue + 0.1, 6);
  Serial.print(",");
  Serial.print(lngValue + 0.1, 6);
  Serial.print("," + String(altitude));
  Serial.println("");
  
  delay(1000);
  
  Serial.print("GPS|");
  Serial.print(latValue, 6);
  Serial.print(",");
  Serial.print(lngValue, 6);
  Serial.print("," + String(altitude));
  Serial.println("");
  
  delay(1000);
}

void loop() {
  if(altitude >= MAX_ALTITUDE){
    ascRate = -ascRate;
  }

  if(altitude <= MIN_ALTITUDE){
    ascRate = -ascRate;
  }
  
  Serial.print("GPS|");
  Serial.print(latValue, 6);
  Serial.print(",");
  Serial.print(lngValue, 6);
  Serial.print("," + String(altitude));
  Serial.println("");
  
  altitude += ascRate;
  latValue += latIncRate;
  lngValue += lngIncRate;

  latIncRate = float(random(-10,30)) / float(1000000);
  lngIncRate = float(random(-10,30)) / float(1000000);
  
  delay(1000);
}
