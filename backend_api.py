import sys
import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS

# Ensure the fusion_model directory is in path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

try:
    from fusion_model.realtime_api_listener import RealtimeFusionEngine
except ImportError as e:
    print(f"Error importing RealtimeFusionEngine: {e}")
    sys.exit(1)

app = Flask(__name__)
CORS(app) # Enable CORS for all routes

print("Initializing Realtime Fusion Engine (Loading PyTorch Model...)")
engine = RealtimeFusionEngine()

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.json or {}
        batch_key = data.get('batchKey', 'unknown_batch')
        
        # 1. Check if frontend provided real-time telemetry from WebSocket
        sensor_data = {
            "temperature": data.get('sensor_temperature'),
            "humidity": data.get('sensor_humidity'),
            "eco2": data.get('sensor_eco2'),
            "tvoc": data.get('sensor_tvoc') # if available
        }
        
        # Fallback to internal engine fetching if frontend didn't provide it
        if sensor_data["temperature"] is None:
            sensor_data = engine.fetch_sensor_telemetry()
        
        # 2. Extract visual features (in a full system, you would run CNN on the uploaded image)
        # Here we accept optional simulated image features from frontend or default to fresh.
        green_ratio = data.get('greenRatio', 0.1)
        red_ratio = data.get('redRatio', 0.7)
        dark_spot = data.get('darkSpotRatio', 0.02)
        mold = data.get('moldRatio', 0.0)
        roughness = data.get('textureRoughness', 0.12)
        
        visual_features = [green_ratio, red_ratio, dark_spot, mold, roughness]

        # ── Not-Tomato Backend Guard ──
        # If both red and green pixel ratios are negligible the image is unlikely a tomato.
        if red_ratio < 0.05 and green_ratio < 0.05:
            return jsonify({
                "success": False,
                "not_tomato": True,
                "error": "Not a tomato: insufficient tomato-colored pixels detected in image."
            })

        # 3. Run Fusion Model Inference
        result = engine.predict(sensor_data, visual_features=visual_features)
        
        # Structure the response for our frontend
        frontend_response = {
            "success": True,
            "grade": result["fusion_prediction"]["quality_grade"],
            "confidence": result["fusion_prediction"]["class_confidence"] * 100,
            "spoilageIndex": 100 - int(result["fusion_prediction"]["class_confidence"] * 100) if "Fresh" in result["fusion_prediction"]["quality_grade"] else int(result["fusion_prediction"]["class_confidence"] * 100),
            "freshnessScore": int(result["fusion_prediction"]["class_confidence"] * 100) if "Fresh" in result["fusion_prediction"]["quality_grade"] else 100 - int(result["fusion_prediction"]["class_confidence"] * 100),
            "shelfLifeDays": result["fusion_prediction"]["remaining_shelf_life_days"],
            "telemetry": {
                "temperature": result["sensor_readings"]["temperature_c"],
                "humidity": result["sensor_readings"]["humidity_pct"],
                "eco2": result["sensor_readings"]["eco2_ppm"]
            },
            "recommendation": result["fusion_prediction"]["preventive_action"]
        }
        
        return jsonify(frontend_response)
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    print("===============================================================")
    print("--> Fusion API Server running on http://127.0.0.1:5000")
    print("===============================================================")
    app.run(host='0.0.0.0', port=5000, debug=False)
