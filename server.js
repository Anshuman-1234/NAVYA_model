const express = require("express");
const mqtt = require("mqtt");
const cors = require("cors");
const path = require("path");

// =================================================
// EXPRESS
// =================================================
const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files from 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// =================================================
// MQTT
// =================================================
const MQTT_BROKER = "mqtt://broker.hivemq.com:1883";
const MQTT_TOPIC = "navya/anshuman/sensors";

// =================================================
// Store latest sensor data
// =================================================
let latestData = {
    device: "NAVYA",
    temperature: null,
    humidity: null,
    eco2: null,
    tvoc: null,
    timestamp: null
};

// =================================================
// MQTT CONNECT
// =================================================
console.log("Connecting to MQTT broker...");
const mqttClient = mqtt.connect(MQTT_BROKER);

// =================================================
// MQTT CONNECTED
// =================================================
mqttClient.on("connect", () => {
    console.log("\n================================");
    console.log("MQTT CONNECTED");
    console.log("================================");
    console.log("Broker:", MQTT_BROKER);
    console.log("Topic:", MQTT_TOPIC);

    mqttClient.subscribe(MQTT_TOPIC, (error) => {
        if (error) {
            console.error("Subscribe error:", error);
        } else {
            console.log("Subscribed successfully!");
            console.log("Waiting for ESP32 data...");
        }
    });
});

// =================================================
// MQTT MESSAGE
// =================================================
mqttClient.on("message", (topic, message) => {
    try {
        const rawData = message.toString();
        console.log("\nMQTT MESSAGE RECEIVED:\n", rawData);
        const data = JSON.parse(rawData);

        latestData = {
            device: data.device || "NAVYA",
            temperature: data.temperature,
            humidity: data.humidity,
            eco2: data.eco2,
            tvoc: data.tvoc,
            timestamp: new Date().toISOString()
        };

        console.log("\n========== EXTRACTED DATA ==========");
        console.log("Device       :", latestData.device);
        console.log("Temperature  :", latestData.temperature, "°C");
        console.log("Humidity     :", latestData.humidity, "%");
        console.log("eCO2         :", latestData.eco2, "ppm");
        console.log("TVOC         :", latestData.tvoc, "ppb");
        console.log("Received     :", latestData.timestamp);
        console.log("=====================================");
    } catch (error) {
        console.error("Invalid MQTT JSON:", error.message);
    }
});

// =================================================
// HTTP API
// =================================================
app.get("/api/data", (req, res) => {
    res.json(latestData);
});

// Health check endpoint
app.get("/api/status", (req, res) => {
    res.json({
        status: "online",
        service: "NAVYA MQTT Sensor API",
        mqttTopic: MQTT_TOPIC,
        latestData: latestData
    });
});

// =================================================
// SERVER
// =================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log("\n================================");
    console.log("NAVYA FRONTEND & BACKEND RUNNING");
    console.log("Port:", PORT);
    console.log("================================");
    console.log(`Frontend UI : http://localhost:${PORT}`);
    console.log(`Sensor API  : http://localhost:${PORT}/api/data`);
    console.log(`Status API  : http://localhost:${PORT}/api/status`);
});
