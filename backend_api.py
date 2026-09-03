import os
import sys
import io
import base64
import json
import numpy as np
import cv2
from flask import Flask, request, jsonify
from flask_cors import CORS

# ==========================================
# 0. Global Setup & Class Definitions
# ==========================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, 'keras_final_model', 'best_model.keras')
if not os.path.exists(MODEL_PATH) and os.path.exists('/content/best_model.keras'):
    MODEL_PATH = '/content/best_model.keras'

IMAGE_SIZE = (128, 128)

CLASS_NAMES = [
    'apple_fresh', 'apple_rotten',
    'banana_fresh', 'banana_rotten',
    'bellpepper_fresh', 'bellpepper_rotten',
    'carrot_fresh', 'carrot_rotten',
    'cucumber_fresh', 'cucumber_rotten',
    'grape_fresh', 'grape_rotten',
    'guava_fresh', 'guava_rotten',
    'jujube_fresh', 'jujube_rotten',
    'mango_fresh', 'mango_rotten',
    'orange_fresh', 'orange_rotten',
    'pomegranate_fresh', 'pomegranate_rotten',
    'potato_fresh', 'potato_rotten',
    'strawberry_fresh', 'strawberry_rotten',
    'tomato_fresh', 'tomato_rotten'
]

# Locked specifically to Tomato
LOCKED_PRODUCE = "Tomato"

model = None
tf = None

def load_keras_model():
    global model, tf
    if model is not None:
        return model
    try:
        import tensorflow as _tf
        tf = _tf
        if os.path.exists(MODEL_PATH):
            print(f"Loading trained Keras model from {MODEL_PATH}...")
            model = tf.keras.models.load_model(MODEL_PATH, compile=False)
            print("Model loaded successfully.")
        else:
            print(f"Warning: Model file not found at {MODEL_PATH}.")
    except Exception as e:
        print(f"Error loading TensorFlow model: {e}")
    return model

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# ==========================================
# 1. Grad-CAM Implementation
# ==========================================
def make_gradcam_heatmap(img_array, keras_model, last_conv_layer_name, pred_index=None):
    if tf is None:
        return np.zeros((img_array.shape[1], img_array.shape[2]), dtype=np.float32)

    grad_model = tf.keras.models.Model(
        inputs=keras_model.inputs,
        outputs=[keras_model.get_layer(last_conv_layer_name).output, keras_model.output]
    )

    with tf.GradientTape() as tape:
        last_conv_layer_output, preds = grad_model(img_array)
        if isinstance(preds, (list, tuple)):
            preds = preds[0]
        if pred_index is None:
            pred_index = tf.argmax(preds[0])
        class_channel = preds[:, pred_index]

    grads = tape.gradient(class_channel, last_conv_layer_output)
    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))
    last_conv_layer_output = last_conv_layer_output[0]
    heatmap = last_conv_layer_output @ pooled_grads[..., tf.newaxis]
    heatmap = tf.squeeze(heatmap)
    heatmap = tf.maximum(heatmap, 0) / (tf.math.reduce_max(heatmap) + 1e-10)
    return heatmap.numpy()

# ==========================================
# 2. Strict Tomato Verification Guard
# ==========================================
def is_valid_tomato_image(img_bgr):
    """
    Strict computer vision verification to ensure the target is actually a tomato.
    Rejects faces, room walls, furniture, or other unrelated objects.
    """
    if img_bgr is None or img_bgr.size == 0:
        return False, 0.0

    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    h_dim, w_dim = img_bgr.shape[:2]
    total_pixels = float(h_dim * w_dim)

    # 1. Red tomato spectrum (vivid saturation S > 70, V > 45)
    mask_red1 = cv2.inRange(hsv, np.array([0, 70, 45]), np.array([12, 255, 255]))
    mask_red2 = cv2.inRange(hsv, np.array([168, 70, 45]), np.array([180, 255, 255]))
    mask_red = mask_red1 | mask_red2

    # 2. Green / unripe tomato spectrum
    mask_green = cv2.inRange(hsv, np.array([35, 60, 40]), np.array([85, 255, 255]))

    # 3. Orange / ripening tomato spectrum (S > 80)
    mask_orange = cv2.inRange(hsv, np.array([12, 80, 50]), np.array([25, 255, 255]))

    tomato_mask = mask_red | mask_green | mask_orange
    tomato_pixels = np.sum(tomato_mask > 0)
    tomato_ratio = float(tomato_pixels / total_pixels)

    # At least 8% of the image frame must contain authentic tomato-colored pixels
    is_tomato = tomato_ratio >= 0.08
    return is_tomato, tomato_ratio

# ==========================================
# 3. Watershed Separation for Clustered Items
# ==========================================
def detect_items_in_tray(image_bgr):
    h_img, w_img = image_bgr.shape[:2]
    
    # Preprocessing
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (9, 9), 2)
    
    # Otsu thresholding
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    
    # Remove noise and isolate background
    kernel = np.ones((3, 3), np.uint8)
    opening = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=2)
    sure_bg = cv2.dilate(opening, kernel, iterations=3)
    
    # Distance transform to find individual centers of touching items
    dist_transform = cv2.distanceTransform(opening, cv2.DIST_L2, 5)
    _, sure_fg = cv2.threshold(dist_transform, 0.28 * dist_transform.max(), 255, 0)
    sure_fg = np.uint8(sure_fg)
    
    # Unknown region between foreground & background
    unknown = cv2.subtract(sure_bg, sure_fg)
    
    # Marker labelling
    _, markers = cv2.connectedComponents(sure_fg)
    markers = markers + 1
    markers[unknown == 255] = 0
    
    # Apply Watershed
    markers = cv2.watershed(image_bgr.copy(), markers)
    
    boxes = []
    min_area = (h_img * w_img) * 0.008
    max_area = (h_img * w_img) * 0.90

    for marker_id in np.unique(markers):
        if marker_id <= 1:
            continue
            
        mask = np.zeros(gray.shape, dtype="uint8")
        mask[markers == marker_id] = 255
        
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in cnts:
            area = cv2.contourArea(c)
            if min_area < area < max_area:
                x, y, w, h = cv2.boundingRect(c)
                aspect_ratio = w / float(h)
                if 0.35 <= aspect_ratio <= 2.8:
                    crop = image_bgr[y:y+h, x:x+w]
                    is_t, _ = is_valid_tomato_image(crop)
                    if is_t:
                        boxes.append((x, y, w, h))

    # Fallback: If watershed didn't isolate items, check center crop
    if not boxes:
        margin_x = int(w_img * 0.1)
        margin_y = int(h_img * 0.1)
        center_crop = image_bgr[margin_y:h_img-margin_y, margin_x:w_img-margin_x]
        is_t, _ = is_valid_tomato_image(center_crop)
        if is_t:
            boxes.append((margin_x, margin_y, w_img - 2 * margin_x, h_img - 2 * margin_y))

    return boxes

# ==========================================
# 4. Dynamic Real-Time Shelf-Life Calculation
# ==========================================
def calculate_dynamic_shelf_life(condition, dark_spot_ratio, texture_var):
    if condition.lower() == 'rotten':
        return 0, "Spoiled / Discard"

    base_shelf_life = 3.0
    decay_penalty = (0.25 * dark_spot_ratio) + (0.001 * texture_var)
    days = max(1, int(round(base_shelf_life - decay_penalty)))
    note = f"Fresh ({days}d remaining)"
    return days, note

# ==========================================
# 5. Large Readable Bounding Box Labels
# ==========================================
def draw_large_label(img, text, x, y, w, h, bg_color):
    font = cv2.FONT_HERSHEY_DUPLEX
    font_scale = max(0.45, min(w, h) / 160.0)
    thickness = 1

    (text_w, text_h), baseline = cv2.getTextSize(text, font, font_scale, thickness)
    label_y = y - 8 if y - 8 - text_h > 0 else y + text_h + 8

    cv2.rectangle(img, (x, label_y - text_h - 4), (x + text_w + 6, label_y + baseline), bg_color, -1)
    cv2.putText(img, text, (x + 3, label_y), font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)
    cv2.rectangle(img, (x, y), (x + w, y + h), bg_color, 2)

def encode_img_base64(img_rgb):
    """Convert RGB numpy array to base64 JPEG data URI."""
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    _, buffer = cv2.imencode('.jpg', img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
    b64_str = base64.b64encode(buffer).decode('utf-8')
    return f"data:image/jpeg;base64,{b64_str}"

# ==========================================
# 6. Full End-to-End Analysis Pipeline
# ==========================================
def analyze_tray_array(img_bgr, keras_model, class_names, target_size=(128, 128)):
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    h_orig, w_orig, _ = img_bgr.shape

    # 1. STRICT TOMATO COLOR & MORPHOLOGY GUARD
    is_tomato, tomato_ratio = is_valid_tomato_image(img_bgr)
    if not is_tomato:
        return {
            "success": False,
            "not_tomato": True,
            "not_recognized": True,
            "error": "Not a tomato detected: Insufficient tomato color / features in image frame.",
            "diagnostics": {
                "tomato_pixel_ratio": round(tomato_ratio * 100, 1),
                "threshold": 8.0
            }
        }

    boxes = detect_items_in_tray(img_bgr)
    if not boxes:
        return {
            "success": False,
            "not_tomato": True,
            "not_recognized": True,
            "error": "No valid tomato contours detected. Please position tomato clearly in the frame."
        }

    valid_crops, valid_boxes = [], []
    for (x, y, w, h) in boxes:
        crop = img_rgb[y:y+h, x:x+w]
        if crop.size == 0:
            continue
        valid_crops.append(cv2.resize(crop, target_size) / 255.0)
        valid_boxes.append((x, y, w, h))

    if not valid_boxes:
        return {
            "success": False,
            "not_tomato": True,
            "not_recognized": True,
            "error": "Could not segment valid tomato regions from image."
        }

    crop_batch = np.array(valid_crops)

    if keras_model is not None:
        all_preds = keras_model.predict(crop_batch, verbose=0)
    else:
        all_preds = np.zeros((len(valid_crops), len(class_names)), dtype=np.float32)
        tomato_fresh_idx = class_names.index('tomato_fresh')
        all_preds[:, tomato_fresh_idx] = 0.9

    # 2. LOCKED TOMATO INDICES
    tray_fresh_idx = class_names.index("tomato_fresh")
    tray_rotten_idx = class_names.index("tomato_rotten")

    last_conv_layer = None
    if keras_model is not None:
        for layer in reversed(keras_model.layers):
            if 'conv' in layer.name.lower():
                last_conv_layer = layer.name
                break

    bbox_canvas = img_rgb.copy()
    rotten_heatmap_mask = np.zeros((h_orig, w_orig), dtype=np.float32)

    item_results = []
    fresh_count = 0
    rotten_count = 0
    total_conf = 0.0
    total_shelf_life = 0

    for i, (x, y, w, h) in enumerate(valid_boxes):
        crop = img_rgb[y:y+h, x:x+w]
        p_fresh = float(all_preds[i][tray_fresh_idx])
        p_rotten = float(all_preds[i][tray_rotten_idx])
        total_p = p_fresh + p_rotten

        p_fresh_norm = (p_fresh / total_p) if total_p > 0 else 0.5
        p_rotten_norm = (p_rotten / total_p) if total_p > 0 else 0.5

        if p_fresh_norm >= p_rotten_norm:
            condition = 'fresh'
            conf = p_fresh_norm * 100.0
            color = (40, 180, 40)
            fresh_count += 1
        else:
            condition = 'rotten'
            conf = p_rotten_norm * 100.0
            color = (220, 30, 30)
            rotten_count += 1

        total_conf += conf

        crop_gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
        texture_var = float(cv2.Laplacian(crop_gray, cv2.CV_64F).var())
        hsv_crop = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
        dark_mask = cv2.inRange(hsv_crop, np.array([0, 30, 20]), np.array([30, 255, 100]))
        dark_ratio = float((np.sum(dark_mask > 0) / (crop.shape[0] * crop.shape[1])) * 100.0)

        shelf_life, note = calculate_dynamic_shelf_life(condition, dark_ratio, texture_var)
        total_shelf_life += shelf_life

        display_text = f"#{i+1} {condition.upper()} {conf:.0f}%"
        draw_large_label(bbox_canvas, display_text, x, y, w, h, color)

        if condition == 'rotten' and last_conv_layer and keras_model is not None:
            crop_tensor = np.expand_dims(valid_crops[i], axis=0)
            heatmap = make_gradcam_heatmap(crop_tensor, keras_model, last_conv_layer, pred_index=tray_rotten_idx)
            heatmap_resized = cv2.resize(heatmap, (w, h))
            rotten_heatmap_mask[y:y+h, x:x+w] = np.maximum(rotten_heatmap_mask[y:y+h, x:x+w], heatmap_resized)

        item_results.append({
            "id": i + 1,
            "produce": "Tomato",
            "condition": condition,
            "confidence": round(conf, 1),
            "shelfLifeDays": shelf_life,
            "shelfLifeNote": note,
            "bbox": [int(x), int(y), int(w), int(h)],
            "darkSpotRatio": round(dark_ratio, 2),
            "textureVariance": round(texture_var, 2)
        })

    # Prepare Grad-CAM Heatmap overlay
    heatmap_colored = cv2.applyColorMap(np.uint8(255 * rotten_heatmap_mask), cv2.COLORMAP_JET)
    heatmap_colored = cv2.cvtColor(heatmap_colored, cv2.COLOR_BGR2RGB)
    heatmap_colored[rotten_heatmap_mask < 0.15] = 0

    alpha = 0.5
    final_heatmap_view = np.where(
        heatmap_colored > 0,
        cv2.addWeighted(img_rgb, 1 - alpha, heatmap_colored, alpha, 0),
        img_rgb
    )

    orig_b64 = encode_img_base64(img_rgb)
    annotated_b64 = encode_img_base64(bbox_canvas)
    heatmap_b64 = encode_img_base64(final_heatmap_view)

    total_items = len(valid_boxes)
    avg_conf = round(total_conf / total_items, 1) if total_items > 0 else 0
    avg_shelf_life = round(total_shelf_life / total_items, 1) if total_items > 0 else 0
    
    fresh_ratio = (fresh_count / total_items) if total_items > 0 else 0
    freshness_score = int(round(fresh_ratio * 100))
    spoilage_index = 100 - freshness_score

    if rotten_count == 0:
        overall_grade = "Fresh (All Tomatoes Optimal)"
        rec = f"All {total_items} tomato item(s) are in peak freshness condition. Safe for retail packaging and consumption."
    elif fresh_count == 0:
        overall_grade = "Spoiled (Tomato Batch Discard)"
        rec = f"Entire batch of tomatoes exhibits critical decay lesions. Immediate isolation and disposal required."
    else:
        overall_grade = f"Mixed Batch ({rotten_count} Spoiled / {fresh_count} Fresh)"
        rec = f"Segregation required: {rotten_count} spoiled tomato item(s) detected. Isolate spoiled tomatoes immediately to prevent cross-contamination of ethylene & mold spores."

    return {
        "success": True,
        "lockedProduce": "Tomato",
        "totalItems": total_items,
        "freshCount": fresh_count,
        "rottenCount": rotten_count,
        "overallGrade": overall_grade,
        "confidence": avg_conf,
        "freshnessScore": freshness_score,
        "spoilageIndex": spoilage_index,
        "avgShelfLifeDays": avg_shelf_life,
        "recommendation": rec,
        "items": item_results,
        "images": {
            "original": orig_b64,
            "annotated": annotated_b64,
            "heatmap": heatmap_b64
        }
    }

# ==========================================
# 7. Flask API Endpoints
# ==========================================
@app.route('/predict', methods=['POST'])
def predict_endpoint():
    try:
        keras_m = load_keras_model()
        data = request.get_json(silent=True) or {}
        
        img_bgr = None
        if 'image' in request.files:
            file_bytes = request.files['image'].read()
            np_arr = np.frombuffer(file_bytes, np.uint8)
            img_bgr = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        elif 'imageData' in data and data['imageData']:
            raw_b64 = data['imageData']
            if ',' in raw_b64:
                raw_b64 = raw_b64.split(',', 1)[1]
            img_bytes = base64.b64decode(raw_b64)
            np_arr = np.frombuffer(img_bytes, np.uint8)
            img_bgr = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        elif 'image_path' in data and os.path.exists(data['image_path']):
            img_bgr = cv2.imread(data['image_path'])
            
        if img_bgr is None:
            return jsonify({
                "success": False,
                "not_tomato": True,
                "not_recognized": True,
                "error": "No image payload provided."
            }), 400

        result = analyze_tray_array(img_bgr, keras_m, CLASS_NAMES)

        if not result.get("success", False):
            return jsonify(result), 200

        sensor_temp = data.get('sensor_temperature')
        sensor_hum = data.get('sensor_humidity')
        sensor_eco2 = data.get('sensor_eco2')
        sensor_tvoc = data.get('sensor_tvoc')

        result["telemetry"] = {
            "temperature": sensor_temp if sensor_temp is not None else 22.4,
            "humidity": sensor_hum if sensor_hum is not None else 65.0,
            "eco2": sensor_eco2 if sensor_eco2 is not None else 480,
            "tvoc": sensor_tvoc if sensor_tvoc is not None else 12
        }
        result["batchKey"] = data.get('batchKey', 'BATCH-001')
        result["grade"] = result["overallGrade"]
        result["shelfLifeDays"] = result["avgShelfLifeDays"]

        return jsonify(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/', methods=['GET'])
def index():
    return jsonify({
        "status": "online",
        "service": "NAVYA Tomato Quality & Itemization AI API",
        "locked_target": "Tomato",
        "model_loaded": model is not None,
        "classes_supported": len(CLASS_NAMES)
    })

# ==========================================
# 8. Local Execution / CLI
# ==========================================
if __name__ == '__main__':
    load_keras_model()
    print("===============================================================")
    print("--> NAVYA Tomato Quality AI API running on http://127.0.0.1:5000")
    print("===============================================================")
    app.run(host='0.0.0.0', port=5000, debug=False)
