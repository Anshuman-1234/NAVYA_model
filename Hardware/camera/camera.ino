#include <Arduino.h>
#include <Wire.h>

#define SDA_PIN 4
#define SCL_PIN 5

void setup()
{
  Serial.begin(115200);
  delay(2000);

  Serial.println();
  Serial.println("==============================");
  Serial.println("OV7670 SCCB TEST");
  Serial.println("==============================");

  Wire.setSDA(SDA_PIN);
  Wire.setSCL(SCL_PIN);
  Wire.begin();

  Wire.setClock(100000);

  delay(500);

  Serial.println("Scanning...");

  int found = 0;

  for (uint8_t address = 1; address < 127; address++)
  {
    Wire.beginTransmission(address);

    uint8_t error = Wire.endTransmission();

    if (error == 0)
    {
      Serial.print("FOUND: 0x");

      if (address < 16)
        Serial.print("0");

      Serial.println(address, HEX);

      found++;
    }
  }

  Serial.println();

  if (found == 0)
  {
    Serial.println("NO DEVICE FOUND");
  }
  else
  {
    Serial.print("TOTAL DEVICES: ");
    Serial.println(found);
  }
}

void loop()
{
}