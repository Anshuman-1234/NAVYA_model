import os
import sys
import time
import json
import pickle
import requests
import numpy as np
from PIL import Image
import torch
try:
    import paho.mqtt.client as mqtt
    HAS_MQTT = True
except ImportError:
    mqtt = None
    HAS_MQTT = False

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fusion_model.fusion_architecture import MultimodalFusionModel
from fusion_model.dataset_builder import CLASSES

PREVENTIVE_ACTIONS = {
    "Fresh_Early_Firm": "Store stem-down at room temperature (15-20°C). Keep away from direct sunlight; avoid refrigeration to allow uniform ripening.",
    "Fresh_Ripe_Peak": "Optimal for immediate distribution or consumption. Store in cool, well-ventilated dry area (10-12°C).",
    "Overripe": "High respiration rate detected. Consume or process immediately (sauce/paste). Isolate from firm tomatoes to prevent accelerated ethylene ripening.",
    "Defective_Spoiled": "CRITICAL WARNING: Fungal rot / microbial respiration gas spike detected. Immediately remove unit batch to prevent rot contagion."
}

class RealtimeFusionEngine:
    def __init__(
        self,
        model_dir="data/saved_models",
        http_api_url="http://localhost:3000/api/data",
        secondary_http_url="http://192.168.1.100:3000/api/data",
        mqtt_broker="broker.hivemq.com",
        mqtt_port=1883,
        mqtt_topic="navya/esp32/sensor/data/001"
    ):
        self.http_api_url = http_api_url
        self.secondary_http_url = secondary_http_url
        self.mqtt_broker = mqtt_broker
        self.mqtt_port = mqtt_port
        self.mqtt_topic = mqtt_topic
        self.latest_sensor_data = None
        
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        
        # Load scaler
        scaler_path = os.path.join(model_dir, "sensor_scaler.pkl")
        if os.path.exists(scaler_path):
            with open(scaler_path, "rb") as f:
                self.scaler = pickle.load(f)
        else:
            self.scaler = None
            
        # Load Multimodal Fusion model
        self.model = MultimodalFusionModel(visual_in=5, sensor_in=4, num_classes=2).to(self.device)
        model_path = os.path.join(model_dir, "fusion_best_model.pth")
        if os.path.exists(model_path):
            self.model.load_state_dict(torch.load(model_path, map_location=self.device))
            self.model.eval()
            print(f"[RealtimeEngine] Successfully loaded Multimodal Fusion model weights from {model_path}")
        else:
            print(f"[RealtimeEngine] Warning: Model weights not found at {model_path}. Run training first.")
            
        # Initialize MQTT Client
        try:
            self.mqtt_client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
        except AttributeError:
            self.mqtt_client = mqtt.Client()
            
        self.mqtt_client.on_connect = self._on_mqtt_connect
        self.mqtt_client.on_message = self._on_mqtt_message
        try:
            print(f"[MQTT] Connecting to broker at {self.mqtt_broker}:{self.mqtt_port}...")
            self.mqtt_client.connect(self.mqtt_broker, self.mqtt_port, 60)
            self.mqtt_client.loop_start()
        except Exception as e:
            print(f"[MQTT] Warning: Could not connect to broker at {self.mqtt_broker}:{self.mqtt_port}: {e}")

    def _on_mqtt_connect(self, client, userdata, flags, rc, *args, **kwargs):
        if rc == 0 or (hasattr(rc, "is_success") and rc.is_success):
            print(f"[MQTT] Connected successfully! Subscribing to topic: {self.mqtt_topic}")
            client.subscribe(self.mqtt_topic)
        else:
            print(f"[MQTT] Connection failed with code {rc}")

    def _on_mqtt_message(self, client, userdata, msg):
        try:
            payload = msg.payload.decode('utf-8')
            data = json.loads(payload)
            self.latest_sensor_data = data
            print(f"[MQTT] Received live sensor data from HiveMQ ({self.mqtt_topic}): {data}")
        except Exception as e:
            print(f"[MQTT] Error parsing message: {e}")

    def fetch_sensor_telemetry(self):
        """
        Sequential Check for Live Telemetry:
        1. Checks Node.js Express API (http://localhost:3000/api/data or http://192.168.1.100:3000/api/data)
        2. Checks HiveMQ MQTT Subscriber Cache (navya/esp32/sensor/data/001)
        3. If no telemetry is received yet (temperature is None), raises SYSTEM FAIL.
        """
        # Step 1A: Check Primary HTTP API Endpoint (localhost:3000)
        for url in [self.http_api_url, self.secondary_http_url]:
            try:
                resp = requests.get(url, timeout=2.0)
                if resp.status_code == 200:
                    data = resp.json()
                    if data and data.get("temperature") is not None:
                        print(f"[HTTP] Successfully fetched live sensor telemetry from {url}: {data}")
                        return data
                    elif data:
                        print(f"[HTTP] {url} responded, but sensor data is null (waiting for ESP32)...")
            except Exception as err:
                print(f"[HTTP] GET {url} failed: {err}")

        # Step 2: Check MQTT Cached Data
        if self.latest_sensor_data is not None and self.latest_sensor_data.get("temperature") is not None:
            print(f"[MQTT] Using live cached telemetry from topic '{self.mqtt_topic}': {self.latest_sensor_data}")
            return self.latest_sensor_data

        # Step 3: Neither source returned valid telemetry -> SYSTEM FAIL
        raise RuntimeError(
            f"SYSTEM FAIL: No live telemetry received from Node.js Express API ({self.http_api_url}) "
            f"or HiveMQ MQTT Broker ({self.mqtt_broker} -> {self.mqtt_topic}). "
            f"Please verify that ESP32 is powered on and publishing sensor data."
        )

    def predict(self, sensor_dict, visual_features=None):
        """
        Runs multimodal fusion inference on live sensor dictionary and visual features / image.
        """
        temp = sensor_dict.get("temperature", 25.0)
        rh = sensor_dict.get("humidity", 70.0)
        eco2 = sensor_dict.get("eco2", 500)
        tvoc = sensor_dict.get("tvoc", 20)
        
        raw_sns = np.array([[temp, rh, eco2, tvoc]], dtype=np.float32)
        if self.scaler is not None:
            sns_norm = self.scaler.transform(raw_sns)
        else:
            sns_norm = raw_sns
            
        sns_tensor = torch.tensor(sns_norm, dtype=torch.float32).to(self.device)
        
        if visual_features is None:
            # Default fresh peak ripe visual features [green_ratio, red_ratio, dark_spot_ratio, mold_ratio, texture_roughness]
            visual_features = [0.02, 0.85, 0.01, 0.00, 120.0]
            
        raw_vis = np.array([visual_features], dtype=np.float32)
        
        if hasattr(self, 'vis_scaler') and self.vis_scaler is not None:
            vis_norm = self.vis_scaler.transform(raw_vis)
        else:
            vis_norm = raw_vis
            
        vis_tensor = torch.tensor(vis_norm, dtype=torch.float32).to(self.device)
        
        with torch.no_grad():
            logits, shelf_life_pred, gate_weights = self.model(vis_tensor, sns_tensor)
            probs = torch.softmax(logits, dim=1).cpu().numpy()[0]
            predicted_class_idx = int(np.argmax(probs))
            predicted_class_name = CLASSES[predicted_class_idx]
            confidence = float(probs[predicted_class_idx])
            shelf_life_days = max(0.0, float(shelf_life_pred.cpu().numpy()[0][0]))
            
            gate_w = float(gate_weights.cpu().numpy()[0][0])
            
        risk_level = "LOW" if predicted_class_idx <= 1 else ("MEDIUM" if predicted_class_idx == 2 else "HIGH / CRITICAL")
        
        payload = {
            "status": "success",
            "device": sensor_dict.get("device", "POSTHARVEST_UNIT"),
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "sensor_readings": {
                "temperature_c": temp,
                "humidity_pct": rh,
                "eco2_ppm": eco2,
                "tvoc_ppb": tvoc
            },
            "fusion_prediction": {
                "quality_grade": predicted_class_name,
                "class_confidence": round(confidence, 4),
                "remaining_shelf_life_days": round(shelf_life_days, 1),
                "spoilage_risk": risk_level,
                "gating_weights": {
                    "vision_branch_weight": round(gate_w, 4),
                    "sensor_branch_weight": round(1.0 - gate_w, 4)
                },
                "preventive_action": PREVENTIVE_ACTIONS.get(predicted_class_name, "Keep in controlled cold storage.")
            }
        }
        return payload

    def start_realtime_stream(self, interval_sec=3.0, iterations=5):
        """
        Continuously polls sensor API and runs real-time fusion inference.
        """
        print(f"\n=======================================================")
        print(f"STARTING REAL-TIME FUSION INFERENCE MONITOR (http://192.168.4.1/api/data)")
        print(f"=======================================================")
        
        for i in range(iterations):
            sensor_data = self.fetch_sensor_telemetry()
            result = self.predict(sensor_data)
            print(f"\n--- Live Telemetry Tick [{i+1}/{iterations}] ---")
            print(json.dumps(result, indent=2))
            time.sleep(interval_sec)

if __name__ == "__main__":
    engine = RealtimeFusionEngine()
    engine.start_realtime_stream(interval_sec=1.5, iterations=3)
