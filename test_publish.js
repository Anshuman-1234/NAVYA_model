const mqtt = require("mqtt");
const client = mqtt.connect("mqtt://broker.hivemq.com:1883");

client.on("connect", () => {
    const payload = JSON.stringify({
        device: "TEST_ESP32",
        temperature: 24.5,
        humidity: 60.2,
        eco2: 450,
        tvoc: 15,
        raw_ethanol: 18500,
        raw_h2: 14200,
        ethanol_index: 0.2,
        ethylene_index: 0.3,
        h2s_index: 0.15
    });
    
    client.publish("navya/anshuman/sensors", payload, () => {
        console.log("Published test payload to navya/anshuman/sensors");
        client.end();
    });
});
