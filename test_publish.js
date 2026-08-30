const mqtt = require("mqtt");
const client = mqtt.connect("mqtt://broker.hivemq.com:1883");

client.on("connect", () => {
    const payload = JSON.stringify({
        device: "TEST_ESP32",
        temperature: 24.5,
        humidity: 60.2,
        eco2: 450,
        tvoc: 15
    });
    
    client.publish("navya/anshuman/sensors", payload, () => {
        console.log("Published test payload to navya/anshuman/sensors");
        client.end();
    });
});
