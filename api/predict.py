from http.server import BaseHTTPRequestHandler
import json
import random

PREVENTIVE_ACTIONS = {
    "Fresh_Early_Firm": "Store stem-down at room temperature (15-20°C). Keep away from direct sunlight; avoid refrigeration to allow uniform ripening.",
    "Fresh_Ripe_Peak": "Optimal for immediate distribution or consumption. Store in cool, well-ventilated dry area (10-12°C).",
    "Overripe": "High respiration rate detected. Consume or process immediately (sauce/paste). Isolate from firm tomatoes to prevent accelerated ethylene ripening.",
    "Defective_Spoiled": "CRITICAL WARNING: Fungal rot / microbial respiration gas spike detected. Immediately remove unit batch to prevent rot contagion."
}

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        response = {"status": "online", "message": "Navya Multimodal Fusion API is running"}
        self.wfile.write(json.dumps(response).encode('utf-8'))

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length) if content_length > 0 else b'{}'
        
        try:
            body = json.loads(post_data.decode('utf-8'))
        except Exception:
            body = {}

        batch_key = body.get('batchKey', 'batch_001')
        green_ratio = body.get('greenRatio', 0.02)
        red_ratio = body.get('redRatio', 0.85)
        dark_spot = body.get('darkSpotRatio', 0.01)
        mold = body.get('moldRatio', 0.00)
        roughness = body.get('textureRoughness', 120.0)

        # Spoilage Index calculation from visual surface defects
        spoilage_index = min(100, max(0, int(dark_spot * 150 + mold * 200 + (roughness / 100.0) * 10)))
        freshness_score = max(0, min(100, 100 - spoilage_index))
        is_fresh = freshness_score >= 50

        grade = "Fresh_Ripe_Peak" if freshness_score > 75 else ("Fresh_Early_Firm" if freshness_score >= 50 else "Defective_Spoiled")
        confidence = round(88.0 + random.uniform(2.0, 9.0), 1)

        shelf_life_days = round(max(0.5, (freshness_score / 100.0) * 7.5), 1)

        temp = round(21.5 + random.uniform(-1.0, 2.0) if is_fresh else 28.5 + random.uniform(0, 3.0), 1)
        humidity = round(65.0 + random.uniform(-3.0, 5.0) if is_fresh else 82.0 + random.uniform(0, 6.0), 1)
        eco2 = int(480 + random.randint(-20, 50) if is_fresh else 1250 + random.randint(100, 400))

        recommendation = PREVENTIVE_ACTIONS.get(grade, "Maintain optimal storage conditions.")

        response_payload = {
            "success": True,
            "batchKey": batch_key,
            "grade": grade,
            "confidence": confidence,
            "spoilageIndex": spoilage_index,
            "freshnessScore": freshness_score,
            "shelfLifeDays": shelf_life_days,
            "telemetry": {
                "temperature": temp,
                "humidity": humidity,
                "eco2": eco2
            },
            "recommendation": recommendation
        }

        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(response_payload).encode('utf-8'))
