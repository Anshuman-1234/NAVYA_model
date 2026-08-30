#include <Wire.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <Adafruit_SHT31.h>
#include <Adafruit_SGP30.h>
#include <LiquidCrystal_I2C.h>

// ============================================================
// WIFI SETTINGS
// ============================================================

const char* WIFI_SSID = "anshu";
const char* WIFI_PASSWORD = "12345678";

// ============================================================
// MQTT SETTINGS
// ============================================================

const char* MQTT_SERVER = "broker.hivemq.com";
const int MQTT_PORT = 1883;

const char* MQTT_TOPIC = "navya/anshuman/sensors";

// Unique client ID
String mqttClientID;

// ============================================================
// WIFI + MQTT
// ============================================================

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

// ============================================================
// TFT PINS
// ============================================================

#define D0 0
#define D1 1
#define D2 2
#define D3 3
#define D4 4
#define D5 5
#define D6 6
#define D7 7

#define TFT_CS 17
#define TFT_RS 27
#define TFT_WR 18
#define TFT_RD 19
#define TFT_RST 26

// ============================================================
// I2C PINS
// ============================================================

#define SDA_PIN 12
#define SCL_PIN 13

// ============================================================
// COLORS
// ============================================================

#define WHITE 0xFFFF
#define BLACK 0x0000
#define GREEN 0x45B3

// ============================================================
// SENSORS + LCD
// ============================================================

Adafruit_SHT31 sht31 = Adafruit_SHT31();
Adafruit_SGP30 sgp30;

LiquidCrystal_I2C lcd(0x27, 16, 2);

// ============================================================
// FAN / RELAY SETTINGS
// ============================================================

#define FAN_RELAY_PIN 16

// Fan turns ON at or above 30C and OFF at or below 28C
const float FAN_ON_TEMP  = 30.0;
const float FAN_OFF_TEMP = 28.0;

bool fanState = false;

// ============================================================
// MQTT TIMING
// ============================================================

unsigned long lastMQTTPublish = 0;

const unsigned long MQTT_PUBLISH_INTERVAL = 5000;

// ============================================================
// SENSOR VALUES
// ============================================================

float temperature = NAN;
float humidity = NAN;

uint16_t eco2 = 0;
uint16_t tvoc = 0;

bool shtOK = false;
bool sgpOK = false;

// ============================================================
// TFT WRITE 8 BIT
// ============================================================

void write8(uint8_t data)
{
  digitalWrite(D0, (data >> 0) & 1);
  digitalWrite(D1, (data >> 1) & 1);
  digitalWrite(D2, (data >> 2) & 1);
  digitalWrite(D3, (data >> 3) & 1);
  digitalWrite(D4, (data >> 4) & 1);
  digitalWrite(D5, (data >> 5) & 1);
  digitalWrite(D6, (data >> 6) & 1);
  digitalWrite(D7, (data >> 7) & 1);

  digitalWrite(TFT_WR, LOW);
  delayMicroseconds(1);
  digitalWrite(TFT_WR, HIGH);
}

// ============================================================
// TFT COMMAND
// ============================================================

void command(uint8_t cmd)
{
  digitalWrite(TFT_CS, LOW);
  digitalWrite(TFT_RS, LOW);

  write8(cmd);

  digitalWrite(TFT_CS, HIGH);
}

// ============================================================
// TFT DATA
// ============================================================

void data8(uint8_t data)
{
  digitalWrite(TFT_CS, LOW);
  digitalWrite(TFT_RS, HIGH);

  write8(data);

  digitalWrite(TFT_CS, HIGH);
}

// ============================================================
// COMMAND + DATA
// ============================================================

void commandData(uint8_t cmd, uint8_t data)
{
  digitalWrite(TFT_CS, LOW);

  digitalWrite(TFT_RS, LOW);
  write8(cmd);

  digitalWrite(TFT_RS, HIGH);
  write8(data);

  digitalWrite(TFT_CS, HIGH);
}

// ============================================================
// TFT ADDRESS WINDOW
// ============================================================

void setAddress(
  uint16_t x1,
  uint16_t y1,
  uint16_t x2,
  uint16_t y2
)
{
  digitalWrite(TFT_CS, LOW);

  // Column address
  digitalWrite(TFT_RS, LOW);
  write8(0x2A);

  digitalWrite(TFT_RS, HIGH);

  write8(x1 >> 8);
  write8(x1 & 0xFF);
  write8(x2 >> 8);
  write8(x2 & 0xFF);

  // Row address
  digitalWrite(TFT_RS, LOW);
  write8(0x2B);

  digitalWrite(TFT_RS, HIGH);

  write8(y1 >> 8);
  write8(y1 & 0xFF);
  write8(y2 >> 8);
  write8(y2 & 0xFF);

  // Memory write
  digitalWrite(TFT_RS, LOW);
  write8(0x2C);

  digitalWrite(TFT_CS, HIGH);
}

// ============================================================
// WRITE COLOR
// ============================================================

void writeColor(uint16_t color)
{
  write8(color >> 8);
  write8(color & 0xFF);
}

// ============================================================
// FILL SCREEN
// ============================================================

void fillScreen(uint16_t color)
{
  setAddress(0, 0, 319, 239);

  digitalWrite(TFT_CS, LOW);
  digitalWrite(TFT_RS, HIGH);

  for (long i = 0; i < 320L * 240L; i++)
  {
    writeColor(color);
  }

  digitalWrite(TFT_CS, HIGH);
}

// ============================================================
// FILL RECTANGLE
// ============================================================

void fillRect(
  int x,
  int y,
  int w,
  int h,
  uint16_t color
)
{
  if (x < 0 || y < 0)
    return;

  if (x + w > 320)
    w = 320 - x;

  if (y + h > 240)
    h = 240 - y;

  if (w <= 0 || h <= 0)
    return;

  setAddress(
    x,
    y,
    x + w - 1,
    y + h - 1
  );

  digitalWrite(TFT_CS, LOW);
  digitalWrite(TFT_RS, HIGH);

  long pixels = (long)w * h;

  for (long i = 0; i < pixels; i++)
  {
    writeColor(color);
  }

  digitalWrite(TFT_CS, HIGH);
}

// ============================================================
// TFT INITIALIZATION
// ============================================================

void initTFT()
{
  digitalWrite(TFT_RST, HIGH);
  delay(10);

  digitalWrite(TFT_RST, LOW);
  delay(100);

  digitalWrite(TFT_RST, HIGH);
  delay(150);

  command(0x01);
  delay(150);

  commandData(0xC0, 0x23);
  commandData(0xC1, 0x10);

  commandData(0xC5, 0x3E);

  // LANDSCAPE
  commandData(0x36, 0x28);

  // RGB565
  commandData(0x3A, 0x55);

  // Frame rate
  command(0xB1);

  data8(0x00);
  data8(0x18);

  // Display function
  command(0xB6);

  data8(0x08);
  data8(0x82);
  data8(0x27);

  // Sleep out
  command(0x11);
  delay(120);

  // Display ON
  command(0x29);
  delay(50);
}

// ============================================================
// EXACT 25 x 25 QR MATRIX
// ============================================================

const uint32_t QR[25] =
{
  0x1FD9E7F,
  0x1057941,
  0x174C15D,
  0x175565D,
  0x174A55D,
  0x104FB41,
  0x1FD557F,
  0x019300,
  0x16EAB4B,
  0x0C94E62,
  0x11698A0,
  0x068B09D,
  0x02657DD,
  0x060B79D,
  0x0D6A89A,
  0x14A65AB,
  0x06715F6,
  0x001871B,
  0x1FD8D5F,
  0x105AF19,
  0x1748DF3,
  0x17542D5,
  0x175C43E,
  0x104FEBC,
  0x1FDA2C7
};

// ============================================================
// READ QR MODULE
// ============================================================

bool qrPixel(int row, int col)
{
  if (row < 0 || row >= 25)
    return false;

  if (col < 0 || col >= 25)
    return false;

  return (QR[row] & (1UL << (24 - col)));
}

// ============================================================
// DRAW QR
// ============================================================

void drawQR()
{
  const int scale = 8;
  const int border = 2;

  const int totalSize =
    (25 + border * 2) * scale;

  const int startX =
    (320 - totalSize) / 2;

  const int startY =
    (240 - totalSize) / 2;

  fillScreen(WHITE);

  for (int row = 0; row < 25; row++)
  {
    for (int col = 0; col < 25; col++)
    {
      if (qrPixel(row, col))
      {
        int x =
          startX +
          (col + border) * scale;

        int y =
          startY +
          (row + border) * scale;

        fillRect(
          x,
          y,
          scale,
          scale,
          GREEN
        );
      }
    }
  }
}

// ============================================================
// LCD STARTUP
// ============================================================

void lcdStartup()
{
  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("Starting Navya");

  lcd.setCursor(0, 1);
  lcd.print("Initializing...");

  delay(2500);

  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("Navya System");

  lcd.setCursor(0, 1);
  lcd.print("Checking...");

  delay(1500);
}

// ============================================================
// WIFI CONNECTION
// ============================================================

void connectWiFi()
{
  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("Connecting WiFi");

  lcd.setCursor(0, 1);
  lcd.print("Please wait...");

  Serial.println();
  Serial.println("Connecting to WiFi...");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;

  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);

    Serial.print(".");

    attempts++;

    if (attempts >= 60)
    {
      Serial.println();
      Serial.println("WiFi connection failed!");

      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("WiFi ERROR");

      lcd.setCursor(0, 1);
      lcd.print("Check WiFi");

      delay(2000);

      attempts = 0;

      WiFi.disconnect();
      delay(500);

      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }

  Serial.println();
  Serial.println("WIFI CONNECTED!");

  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("WiFi Connected");

  lcd.setCursor(0, 1);
  lcd.print(WiFi.localIP());

  delay(2000);
}

// ============================================================
// MQTT CONNECTION
// ============================================================

void connectMQTT()
{
  while (!mqtt.connected())
  {
    Serial.println();
    Serial.print("Connecting to MQTT...");

    mqttClientID =
      "NavyaPicoW-" +
      String((uint32_t)random(0xFFFF), HEX);

    if (mqtt.connect(mqttClientID.c_str()))
    {
      Serial.println("CONNECTED!");

      Serial.print("MQTT Broker: ");
      Serial.println(MQTT_SERVER);

      Serial.print("MQTT Topic: ");
      Serial.println(MQTT_TOPIC);

      lcd.clear();

      lcd.setCursor(0, 0);
      lcd.print("MQTT Connected");

      lcd.setCursor(0, 1);
      lcd.print("Data Online");

      delay(1500);
    }
    else
    {
      Serial.print("FAILED, state=");
      Serial.println(mqtt.state());

      lcd.clear();

      lcd.setCursor(0, 0);
      lcd.print("MQTT ERROR");

      lcd.setCursor(0, 1);
      lcd.print("Retrying...");

      delay(3000);
    }
  }
}

// ============================================================
// FAN TEMPERATURE CONTROL
// ============================================================

void controlFan()
{
  // if (isnan(temperature))
  //   return;

  // if (!fanState && temperature >= FAN_ON_TEMP)
  // {
  //   fanState = true;
  //   // ACTIVE-LOW relay: LOW = ON
  //   digitalWrite(FAN_RELAY_PIN, LOW);

  //   Serial.println("FAN ON");
  //   Serial.print("Temperature: ");
  //   Serial.print(temperature, 1);
  //   Serial.println(" C");
  // }
  // else if (fanState && temperature <= FAN_OFF_TEMP)
  // {
  //   fanState = false;
  //   // ACTIVE-LOW relay: HIGH = OFF
  //   digitalWrite(FAN_RELAY_PIN, HIGH);

  //   Serial.println("FAN OFF");
  //   Serial.print("Temperature: ");
  //   Serial.print(temperature, 1);
  //   Serial.println(" C");
  // }
  digitalWrite(FAN_RELAY_PIN, LOW);
}

// ============================================================
// PUBLISH SENSOR DATA
// ============================================================

void publishSensorData()
{
  if (!mqtt.connected())
    return;

  // ----------------------------------------------------------
  // READ SHT31
  // ----------------------------------------------------------

  float temp = sht31.readTemperature();
  float hum = sht31.readHumidity();

  // ----------------------------------------------------------
  // READ SGP30
  // ----------------------------------------------------------

  bool gasReadOK = sgp30.IAQmeasure();

  // ----------------------------------------------------------
  // SAVE VALUES
  // ----------------------------------------------------------

  temperature = temp;
  humidity = hum;

  if (gasReadOK)
  {
    eco2 = sgp30.eCO2;
    tvoc = sgp30.TVOC;
  }

  // ----------------------------------------------------------
  // CREATE JSON
  // ----------------------------------------------------------

  char payload[256];

  if (!isnan(temp) &&
      !isnan(hum) &&
      gasReadOK)
  {
    snprintf(
      payload,
      sizeof(payload),
      "{\"temperature\":%.2f,\"humidity\":%.2f,\"eco2\":%u,\"tvoc\":%u}",
      temp,
      hum,
      eco2,
      tvoc
    );
  }
  else
  {
    snprintf(
      payload,
      sizeof(payload),
      "{\"temperature\":%.2f,\"humidity\":%.2f,\"eco2\":%u,\"tvoc\":%u}",
      temp,
      hum,
      eco2,
      tvoc
    );
  }

  // ----------------------------------------------------------
  // PUBLISH
  // ----------------------------------------------------------

  bool success =
    mqtt.publish(
      MQTT_TOPIC,
      payload
    );

  if (success)
  {
    Serial.println();
    Serial.println("MQTT PUBLISHED!");

    Serial.print("Topic: ");
    Serial.println(MQTT_TOPIC);

    Serial.print("Data: ");
    Serial.println(payload);
  }
  else
  {
    Serial.println("MQTT PUBLISH FAILED!");
  }
}

// ============================================================
// DISPLAY SENSOR DATA
// ============================================================

void displayTemperatureHumidity()
{
  lcd.clear();

  if (!isnan(temperature) &&
      !isnan(humidity))
  {
    lcd.setCursor(0, 0);

    lcd.print("Temp:");
    lcd.print(temperature, 1);
    lcd.write(223);
    lcd.print("C");

    lcd.setCursor(0, 1);

    lcd.print("Hum:");
    lcd.print(humidity, 1);
    lcd.print("%");
  }
  else
  {
    lcd.setCursor(0, 0);
    lcd.print("SHT31 ERROR");

    lcd.setCursor(0, 1);
    lcd.print("Check sensor");
  }
}

// ============================================================
// DISPLAY GAS DATA
// ============================================================

void displayGasData()
{
  lcd.clear();

  lcd.setCursor(0, 0);

  lcd.print("eCO2:");
  lcd.print(eco2);
  lcd.print("ppm");

  lcd.setCursor(0, 1);

  lcd.print("TVOC:");
  lcd.print(tvoc);
  lcd.print("ppb");
}

// ============================================================
// SETUP
// ============================================================

void setup()
{
  Serial.begin(115200);

  // ==========================================================
  // FAN RELAY SETUP
  // ==========================================================

  pinMode(FAN_RELAY_PIN, OUTPUT);
  // Relay OFF initially (active LOW relay)
  digitalWrite(FAN_RELAY_PIN, HIGH);
  fanState = false;

  delay(1000);

  Serial.println();
  Serial.println("================================");
  Serial.println("       NAVYA SYSTEM START");
  Serial.println("================================");

  // ----------------------------------------------------------
  // TFT DATA PINS
  // ----------------------------------------------------------

  pinMode(D0, OUTPUT);
  pinMode(D1, OUTPUT);
  pinMode(D2, OUTPUT);
  pinMode(D3, OUTPUT);
  pinMode(D4, OUTPUT);
  pinMode(D5, OUTPUT);
  pinMode(D6, OUTPUT);
  pinMode(D7, OUTPUT);

  // ----------------------------------------------------------
  // TFT CONTROL PINS
  // ----------------------------------------------------------

  pinMode(TFT_CS, OUTPUT);
  pinMode(TFT_RS, OUTPUT);
  pinMode(TFT_WR, OUTPUT);
  pinMode(TFT_RD, OUTPUT);
  pinMode(TFT_RST, OUTPUT);

  digitalWrite(TFT_CS, HIGH);
  digitalWrite(TFT_RS, HIGH);
  digitalWrite(TFT_WR, HIGH);
  digitalWrite(TFT_RD, HIGH);
  digitalWrite(TFT_RST, HIGH);

  // ----------------------------------------------------------
  // START TFT
  // ----------------------------------------------------------

  Serial.println("Starting TFT...");

  initTFT();

  Serial.println("Drawing EXACT QR...");

  drawQR();

  Serial.println("QR COMPLETE");

  // ----------------------------------------------------------
  // START I2C
  // ----------------------------------------------------------

  Wire.setSDA(SDA_PIN);
  Wire.setSCL(SCL_PIN);
  Wire.begin();

  // ----------------------------------------------------------
  // START LCD
  // ----------------------------------------------------------

  lcd.init();
  lcd.backlight();

  lcdStartup();

  // ----------------------------------------------------------
  // CHECK SHT31
  // ----------------------------------------------------------

  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("Checking SHT31");

  lcd.setCursor(0, 1);
  lcd.print("Please wait...");

  delay(1000);

  shtOK = sht31.begin(0x44);

  if (shtOK)
  {
    lcd.clear();

    lcd.setCursor(0, 0);
    lcd.print("SHT31: OK");

    delay(1000);

    Serial.println("SHT31 FOUND!");
  }
  else
  {
    lcd.clear();

    lcd.setCursor(0, 0);
    lcd.print("SHT31: ERROR");

    lcd.setCursor(0, 1);
    lcd.print("Check sensor");

    Serial.println("SHT31 NOT FOUND!");

    delay(2000);
  }

  // ----------------------------------------------------------
  // CHECK SGP30
  // ----------------------------------------------------------

  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("Checking SGP30");

  lcd.setCursor(0, 1);
  lcd.print("Please wait...");

  delay(1000);

  sgpOK = sgp30.begin();

  if (sgpOK)
  {
    lcd.clear();

    lcd.setCursor(0, 0);
    lcd.print("SGP30: OK");

    delay(1000);

    Serial.println("SGP30 FOUND!");
  }
  else
  {
    lcd.clear();

    lcd.setCursor(0, 0);
    lcd.print("SGP30: ERROR");

    lcd.setCursor(0, 1);
    lcd.print("Check sensor");

    Serial.println("SGP30 NOT FOUND!");

    delay(2000);
  }

  // ----------------------------------------------------------
  // NAVYA READY
  // ----------------------------------------------------------

  if (shtOK && sgpOK)
  {
    lcd.clear();

    lcd.setCursor(0, 0);
    lcd.print("NAVYA READY");

    lcd.setCursor(0, 1);
    lcd.print("All Systems OK");

    Serial.println("======================");
    Serial.println("     NAVYA READY");
    Serial.println("======================");

    delay(2500);
  }

  // ----------------------------------------------------------
  // WIFI
  // ----------------------------------------------------------

  connectWiFi();

  // ----------------------------------------------------------
  // MQTT
  // ----------------------------------------------------------

  mqtt.setServer(
    MQTT_SERVER,
    MQTT_PORT
  );

  connectMQTT();

  // ----------------------------------------------------------
  // FIRST SENSOR READ
  // ----------------------------------------------------------

  temperature = sht31.readTemperature();
  humidity = sht31.readHumidity();

  // Control fan using first temperature reading
  controlFan();

  if (sgp30.IAQmeasure())
  {
    eco2 = sgp30.eCO2;
    tvoc = sgp30.TVOC;
  }

  publishSensorData();

  lastMQTTPublish = millis();
}

// ============================================================
// LOOP
// ============================================================

void loop()
{
  // ==========================================================
  // CHECK WIFI
  // ==========================================================

  if (WiFi.status() != WL_CONNECTED)
  {
    Serial.println("WiFi disconnected!");

    connectWiFi();
  }

  // ==========================================================
  // CHECK MQTT
  // ==========================================================

  if (!mqtt.connected())
  {
    connectMQTT();
  }

  // MQTT background processing
  mqtt.loop();

  // ==========================================================
  // PUBLISH EVERY 5 SECONDS
  // ==========================================================

  if (millis() - lastMQTTPublish >= MQTT_PUBLISH_INTERVAL)
  {
    lastMQTTPublish = millis();

    // --------------------------------------------------------
    // READ SHT31
    // --------------------------------------------------------

    temperature = sht31.readTemperature();
    humidity = sht31.readHumidity();

    // --------------------------------------------------------
    // FAN TEMPERATURE CONTROL
    // --------------------------------------------------------

    controlFan();

    // --------------------------------------------------------
    // READ SGP30
    // --------------------------------------------------------

    bool gasOK = sgp30.IAQmeasure();

    if (gasOK)
    {
      eco2 = sgp30.eCO2;
      tvoc = sgp30.TVOC;
    }

    // --------------------------------------------------------
    // SERIAL OUTPUT
    // --------------------------------------------------------

    Serial.println();
    Serial.println("==============================");

    if (!isnan(temperature) &&
        !isnan(humidity))
    {
      Serial.print("Temperature: ");
      Serial.print(temperature, 1);
      Serial.println(" C");

      Serial.print("Humidity: ");
      Serial.print(humidity, 1);
      Serial.println(" %");
    }
    else
    {
      Serial.println("SHT31 READ ERROR!");
    }

    if (gasOK)
    {
      Serial.print("eCO2: ");
      Serial.print(eco2);
      Serial.println(" ppm");

      Serial.print("TVOC: ");
      Serial.print(tvoc);
      Serial.println(" ppb");
    }
    else
    {
      Serial.println("SGP30 READ ERROR!");
    }

    // --------------------------------------------------------
    // MQTT
    // --------------------------------------------------------

    publishSensorData();

    Serial.println("==============================");
  }

  // ==========================================================
  // LCD DISPLAY
  // ==========================================================

  static unsigned long lastLCDChange = 0;
  static bool showGas = false;

  if (millis() - lastLCDChange >= 3000)
  {
    lastLCDChange = millis();

    if (showGas)
    {
      displayGasData();
    }
    else
    {
      displayTemperatureHumidity();
    }

    showGas = !showGas;
  }

  delay(10);
}