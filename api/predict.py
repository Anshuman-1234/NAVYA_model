from http.server import BaseHTTPRequestHandler
import json
import random
import base64

PREVENTIVE_ACTIONS = {
    "Fresh": "Store in a cool, well-ventilated dry area (10-15°C). Peak quality for immediate packaging and distribution.",
    "Rotten": "CRITICAL: Spoilage detected. Immediately isolate damaged produce to prevent fungal contagion.",
    "Mixed": "Segregation required: Isolate spoiled produce from fresh batch immediately to prevent accelerated ripening."
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
        response = {"status": "online", "message": "NAVYA Multi-Item AI Fusion API"}
        self.wfile.write(json.dumps(response).encode('utf-8'))

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length) if content_length > 0 else b'{}'
        
        try:
            body = json.loads(post_data.decode('utf-8'))
        except Exception:
            body = {}

        batch_key = body.get('batchKey', 'BATCH-001')
        raw_img = body.get('imageData', '')
        
        # Simulate multi-item tray analysis for serverless environment
        items_count = random.choice([3, 4, 5])
        items = []
        fresh_count = 0
        rotten_count = 0
        total_shelf = 0

        for i in range(1, items_count + 1):
            is_rotten = (i == 2 and random.random() > 0.6)
            if is_rotten:
                cond = "rotten"
                conf = round(random.uniform(85.0, 97.0), 1)
                shelf = 0
                note = "Spoiled / Discard"
                rotten_count += 1
            else:
                cond = "fresh"
                conf = round(random.uniform(91.0, 99.0), 1)
                shelf = random.choice([2, 3, 4])
                note = f"Fresh ({shelf}d remaining)"
                fresh_count += 1
                total_shelf += shelf

            items.append({
                "id": i,
                "produce": "Tomato",
                "condition": cond,
                "confidence": conf,
                "shelfLifeDays": shelf,
                "shelfLifeNote": note,
                "bbox": [50 * i, 60 * i, 120, 120],
                "darkSpotRatio": round(random.uniform(0.5, 4.2), 2),
                "textureVariance": round(random.uniform(15.0, 85.0), 2)
            })

        freshness_score = int(round((fresh_count / items_count) * 100))
        spoilage_index = 100 - freshness_score
        avg_shelf = round(total_shelf / max(1, fresh_count), 1) if fresh_count > 0 else 0

        if rotten_count == 0:
            overall_grade = "Fresh (All Items Optimal)"
            rec = PREVENTIVE_ACTIONS["Fresh"]
        elif fresh_count == 0:
            overall_grade = "Spoiled (Tray Discard)"
            rec = PREVENTIVE_ACTIONS["Rotten"]
        else:
            overall_grade = f"Mixed Batch ({rotten_count} Spoiled / {fresh_count} Fresh)"
            rec = PREVENTIVE_ACTIONS["Mixed"]

        temp = body.get('sensor_temperature') or round(21.5 + random.uniform(-1.0, 2.0), 1)
        hum = body.get('sensor_humidity') or round(65.0 + random.uniform(-3.0, 5.0), 1)
        eco2 = body.get('sensor_eco2') or int(480 + random.randint(-20, 50))
        tvoc = body.get('sensor_tvoc') or random.randint(8, 25)
        raw_eth = body.get('sensor_raw_ethanol') or random.randint(18000, 19500)
        raw_h2 = body.get('sensor_raw_h2') or random.randint(13000, 14500)
        eth_idx = body.get('sensor_ethanol_index') or round(random.uniform(0.1, 0.4), 3)
        ethyle_idx = body.get('sensor_ethylene_index') or round(random.uniform(0.1, 0.5), 3)
        h2s_idx = body.get('sensor_h2s_index') or round(random.uniform(0.05, 0.3), 3)
        
        eatableStatus = "Not Eatable / Toxic" if rotten_count > 0 or eth_idx > 0.4 or h2s_idx > 0.4 else "Safe / Eatable"

        response_payload = {
            "success": True,
            "batchKey": batch_key,
            "lockedProduce": "Tomato",
            "totalItems": items_count,
            "freshCount": fresh_count,
            "rottenCount": rotten_count,
            "overallGrade": overall_grade,
            "confidence": 94.5,
            "freshnessScore": freshness_score,
            "spoilageIndex": spoilage_index,
            "avgShelfLifeDays": avg_shelf,
            "recommendation": rec,
            "eatableStatus": eatableStatus,
            "items": items,
            "images": {
                "original": raw_img,
                "annotated": raw_img,
                "heatmap": raw_img
            },
            "telemetry": {
                "temperature": temp,
                "humidity": hum,
                "eco2": eco2,
                "tvoc": tvoc,
                "raw_ethanol": raw_eth,
                "raw_h2": raw_h2,
                "ethanol_index": eth_idx,
                "ethylene_index": ethyle_idx,
                "h2s_index": h2s_idx
            },
            "grade": overall_grade,
            "shelfLifeDays": avg_shelf
        }

        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(response_payload).encode('utf-8'))
