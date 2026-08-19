#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#include "Adafruit_SGP30.h"
#include "Adafruit_SHT31.h"


// =====================================================
// WIFI
// =====================================================

const char* WIFI_SSID = "anshu";
const char* WIFI_PASSWORD = "12345678";


// =====================================================
// MQTT
// =====================================================

// Public MQTT broker for testing
const char* MQTT_SERVER = "broker.hivemq.com";

const int MQTT_PORT = 1883;


// IMPORTANT:
// Make this topic unique.
// Anyone who knows the topic can subscribe on
// the public broker.
const char* MQTT_TOPIC =
    "navya/esp32/sensor/data/001";


// =====================================================
// OBJECTS
// =====================================================

WiFiClient espClient;

PubSubClient mqttClient(
    espClient
);

Adafruit_SGP30 sgp;

Adafruit_SHT31 sht31 =
    Adafruit_SHT31();

LiquidCrystal_I2C lcd(
    0x27,
    16,
    2
);


// =====================================================
// SENSOR DATA
// =====================================================

float temperature = NAN;

float humidity = NAN;

int eco2 = -1;

int tvoc = -1;


// =====================================================
// TIMING
// =====================================================

unsigned long lastSensorRead = 0;

unsigned long lastPublish = 0;

const unsigned long SENSOR_INTERVAL = 2000;

const unsigned long PUBLISH_INTERVAL = 5000;


// =====================================================
// WIFI CONNECTION
// =====================================================

void connectWiFi() {

    Serial.println();

    Serial.println(
        "Connecting to WiFi..."
    );

    WiFi.mode(WIFI_STA);

    WiFi.begin(
        WIFI_SSID,
        WIFI_PASSWORD
    );

    while (
        WiFi.status() != WL_CONNECTED
    ) {

        delay(500);

        Serial.print(".");
    }

    Serial.println();

    Serial.println(
        "WiFi connected!"
    );

    Serial.print(
        "ESP32 IP: "
    );

    Serial.println(
        WiFi.localIP()
    );
}


// =====================================================
// MQTT CONNECTION
// =====================================================

void connectMQTT() {

    while (
        !mqttClient.connected()
    ) {

        Serial.println();

        Serial.println(
            "Connecting to MQTT..."
        );

        Serial.print(
            "Broker: "
        );

        Serial.println(
            MQTT_SERVER
        );


        // Generate unique client ID

        String clientID =
            "NAVYA_ESP32_";

        clientID +=
            String(
                (uint32_t)ESP.getEfuseMac(),
                HEX
            );


        if (
            mqttClient.connect(
                clientID.c_str()
            )
        ) {

            Serial.println(
                "MQTT CONNECTED!"
            );

        } else {

            Serial.print(
                "MQTT failed, state = "
            );

            Serial.println(
                mqttClient.state()
            );

            Serial.println(
                "Retrying in 3 seconds..."
            );

            delay(3000);
        }
    }
}


// =====================================================
// SENSOR READING
// =====================================================

void readSensors() {

    // SHT31

    float t =
        sht31.readTemperature();

    float h =
        sht31.readHumidity();


    if (!isnan(t)) {

        temperature = t;
    }


    if (!isnan(h)) {

        humidity = h;
    }


    // SGP30

    if (
        sgp.IAQmeasure()
    ) {

        eco2 =
            sgp.eCO2;

        tvoc =
            sgp.TVOC;
    }


    // Serial output

    Serial.println();

    Serial.println(
        "========== SENSOR DATA =========="
    );


    Serial.print(
        "Temperature: "
    );

    Serial.print(
        temperature
    );

    Serial.println(
        " °C"
    );


    Serial.print(
        "Humidity: "
    );

    Serial.print(
        humidity
    );

    Serial.println(
        " %"
    );


    Serial.print(
        "eCO2: "
    );

    Serial.print(
        eco2
    );

    Serial.println(
        " ppm"
    );


    Serial.print(
        "TVOC: "
    );

    Serial.print(
        tvoc
    );

    Serial.println(
        " ppb"
    );


    Serial.println(
        "================================="
    );
}


// =====================================================
// LCD
// =====================================================

void updateLCD() {

    lcd.clear();

    lcd.setCursor(
        0,
        0
    );

    lcd.print(
        "T:"
    );

    lcd.print(
        temperature,
        1
    );

    lcd.print(
        "C H:"
    );

    lcd.print(
        humidity,
        0
    );

    lcd.print(
        "%"
    );


    lcd.setCursor(
        0,
        1
    );

    lcd.print(
        "CO2:"
    );

    lcd.print(
        eco2
    );

    lcd.print(
        " V:"
    );

    lcd.print(
        tvoc
    );
}


// =====================================================
// MQTT PUBLISH
// =====================================================

void publishData() {

    if (
        !mqttClient.connected()
    ) {

        connectMQTT();
    }


    // ---------------------------------------------
    // Create JSON
    // ---------------------------------------------

    String data = "{";


    data +=
        "\"device\":\"NAVYA\",";


    data +=
        "\"temperature\":" +
        String(
            temperature,
            2
        );


    data += ",";


    data +=
        "\"humidity\":" +
        String(
            humidity,
            2
        );


    data += ",";


    data +=
        "\"eco2\":" +
        String(
            eco2
        );


    data += ",";


    data +=
        "\"tvoc\":" +
        String(
            tvoc
        );


    data += "}";


    // ---------------------------------------------
    // Serial
    // ---------------------------------------------

    Serial.println();

    Serial.println(
        "Publishing MQTT:"
    );

    Serial.println(
        data
    );


    // ---------------------------------------------
    // Publish
    // ---------------------------------------------

    bool result =
        mqttClient.publish(
            MQTT_TOPIC,
            data.c_str()
        );


    if (result) {

        Serial.println(
            "DATA SENT SUCCESSFULLY"
        );

    } else {

        Serial.println(
            "DATA SEND FAILED"
        );
    }
}


// =====================================================
// SETUP
// =====================================================

void setup() {

    Serial.begin(
        115200
    );

    delay(1000);


    // ---------------------------------------------
    // I2C
    // ---------------------------------------------

    Wire.begin(
        8,
        9
    );


    // ---------------------------------------------
    // LCD
    // ---------------------------------------------

    lcd.init();

    lcd.backlight();

    lcd.clear();

    lcd.setCursor(
        0,
        0
    );

    lcd.print(
        "NAVYA"
    );

    lcd.setCursor(
        0,
        1
    );

    lcd.print(
        "Starting..."
    );


    // ---------------------------------------------
    // SHT31
    // ---------------------------------------------

    if (
        sht31.begin(0x44)
    ) {

        Serial.println(
            "SHT31 OK"
        );

    } else {

        Serial.println(
            "SHT31 ERROR"
        );
    }


    // ---------------------------------------------
    // SGP30
    // ---------------------------------------------

    if (
        sgp.begin(&Wire)
    ) {

        Serial.println(
            "SGP30 OK"
        );

    } else {

        Serial.println(
            "SGP30 ERROR"
        );
    }


    // ---------------------------------------------
    // WiFi
    // ---------------------------------------------

    connectWiFi();


    // ---------------------------------------------
    // MQTT
    // ---------------------------------------------

    mqttClient.setServer(
        MQTT_SERVER,
        MQTT_PORT
    );

    connectMQTT();


    Serial.println();

    Serial.println(
        "================================="
    );

    Serial.println(
        "NAVYA READY"
    );

    Serial.println(
        "================================="
    );
}


// =====================================================
// LOOP
// =====================================================

void loop() {

    // ---------------------------------------------
    // MQTT
    // ---------------------------------------------

    if (
        !mqttClient.connected()
    ) {

        connectMQTT();
    }

    mqttClient.loop();


    // ---------------------------------------------
    // Sensor reading
    // ---------------------------------------------

    if (
        millis() -
        lastSensorRead >=
        SENSOR_INTERVAL
    ) {

        lastSensorRead =
            millis();

        readSensors();

        updateLCD();
    }


    // ---------------------------------------------
    // MQTT publish
    // ---------------------------------------------

    if (
        millis() -
        lastPublish >=
        PUBLISH_INTERVAL
    ) {

        lastPublish =
            millis();

        publishData();
    }
}