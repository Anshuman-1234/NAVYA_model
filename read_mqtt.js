// ============================================================
// NAVYA - LIVE MQTT SENSOR RECEIVER
// ESP32 -> HiveMQ -> Node.js
// ============================================================

const mqtt = require("mqtt");

// ------------------------------------------------------------
// MQTT CONFIGURATION
// ------------------------------------------------------------

const BROKER_URL = "mqtt://broker.hivemq.com:1883";
const MQTT_TOPIC = "navya/anshuman/sensors";

// ------------------------------------------------------------
// CONNECT TO MQTT BROKER
// ------------------------------------------------------------

const client = mqtt.connect(BROKER_URL, {
    reconnectPeriod: 5000,
    connectTimeout: 10000
});

console.log("==========================================");
console.log("       NAVYA MQTT SENSOR RECEIVER");
console.log("==========================================");
console.log("Broker :", BROKER_URL);
console.log("Topic  :", MQTT_TOPIC);
console.log("------------------------------------------");
console.log("Connecting to HiveMQ...\n");

// ------------------------------------------------------------
// CONNECTED
// ------------------------------------------------------------

client.on("connect", () => {

    console.log("✅ Connected to HiveMQ!");

    client.subscribe(MQTT_TOPIC, { qos: 0 }, (err) => {

        if (err) {
            console.error("❌ Subscription failed:", err.message);
            return;
        }

        console.log("✅ Successfully subscribed!");
        console.log("📡 Waiting for live NAVYA sensor data...\n");
    });
});

// ------------------------------------------------------------
// RECEIVE SENSOR DATA
// ------------------------------------------------------------

client.on("message", (topic, message) => {

    const rawData = message.toString();

    console.log("==========================================");
    console.log("📡 LIVE SENSOR DATA");
    console.log("==========================================");

    console.log("Topic:");
    console.log(topic);

    console.log("\nRaw Data:");
    console.log(rawData);

    console.log("\nReceived At:");
    console.log(new Date().toLocaleString());

    // --------------------------------------------------------
    // TRY TO READ JSON
    // --------------------------------------------------------

    try {

        const data = JSON.parse(rawData);

        console.log("\n----------- SENSOR VALUES -----------");

        if (data.temperature !== undefined) {
            console.log("Temperature : " + data.temperature + " °C");
        }

        if (data.humidity !== undefined) {
            console.log("Humidity    : " + data.humidity + " %");
        }

        if (data.eco2 !== undefined) {
            console.log("eCO2        : " + data.eco2 + " ppm");
        }

        if (data.tvoc !== undefined) {
            console.log("TVOC        : " + data.tvoc + " ppb");
        }

        if (data.timestamp !== undefined) {
            console.log("Timestamp   : " + data.timestamp);
        }

        console.log("------------------------------------");

    } catch (error) {

        console.log("\n⚠ Data is not JSON.");
        console.log("Received as plain text.");

    }

    console.log("==========================================\n");
});

// ------------------------------------------------------------
// MQTT ERROR
// ------------------------------------------------------------

client.on("error", (error) => {

    console.error("❌ MQTT Error:", error.message);

});

// ------------------------------------------------------------
// CONNECTION CLOSED
// ------------------------------------------------------------

client.on("close", () => {

    console.log("⚠ MQTT connection closed.");

});

// ------------------------------------------------------------
// AUTOMATIC RECONNECT
// ------------------------------------------------------------

client.on("reconnect", () => {

    console.log("🔄 Reconnecting to HiveMQ...");

});

// ------------------------------------------------------------
// OFFLINE
// ------------------------------------------------------------

client.on("offline", () => {

    console.log("⚠ MQTT client is offline.");

});

// ------------------------------------------------------------
// GRACEFUL EXIT
// ------------------------------------------------------------

process.on("SIGINT", () => {

    console.log("\n\nStopping NAVYA MQTT receiver...");

    client.end(false, {}, () => {

        console.log("MQTT connection closed.");
        console.log("NAVYA receiver stopped.");

        process.exit(0);

    });

});