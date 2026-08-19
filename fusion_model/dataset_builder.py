import os
import sys
import numpy as np
import pandas as pd
from PIL import Image, ImageFilter
import glob

GRADE_MAP = {
    "Fresh": 0,
    "Rotten": 1
}
CLASSES = ["Fresh", "Rotten"]

def extract_visual_features_from_image(img_pil):
    """
    Extracts quantitative visual feature vector [green_ratio, red_ratio, dark_spot_ratio, mold_ratio, texture_roughness]
    from a PIL Image.
    """
    img_rgb = img_pil.resize((128, 128)).convert("RGB")
    arr = np.array(img_rgb, dtype=np.float32)
    
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    total_pix = arr.shape[0] * arr.shape[1] + 1e-5
    
    # Red & Green color ratios
    red_mask = (r > g * 1.1) & (r > b * 1.1)
    green_mask = (g > r * 1.05) & (g > b * 1.05)
    
    red_ratio = float(np.sum(red_mask) / total_pix)
    green_ratio = float(np.sum(green_mask) / total_pix)
    
    # Dark spot ratio (decay lesions / blemishes)
    dark_mask = (r < 70) & (g < 70) & (b < 70)
    dark_spot_ratio = float(np.sum(dark_mask) / total_pix)
    
    # Mold coverage ratio (pale grayish/fungal areas)
    mold_mask = (r > 160) & (g > 160) & (b > 140) & (np.abs(r - g) < 20) & (np.abs(g - b) < 30)
    mold_ratio = float(np.sum(mold_mask) / total_pix)
    
    # Texture roughness (standard deviation of grayscale image)
    gray = np.mean(arr, axis=2)
    texture_roughness = float(np.std(gray) / 255.0)
    
    return [green_ratio, red_ratio, dark_spot_ratio, mold_ratio, texture_roughness]

def generate_correlated_sensors(is_rotten, dark_spot_ratio, mold_ratio):
    """
    Generates correlated physical sensor readings [Temperature, Humidity, eCO2, TVOC]
    matching fresh vs rotten fruit quality and surface decay features.
    """
    if not is_rotten:
        base_temp, base_rh, base_eco2, base_tvoc = 21.0, 67.0, 480.0, 22.0
    else:
        base_temp, base_rh, base_eco2, base_tvoc = 31.0, 83.0, 1550.0, 310.0

    temp = base_temp + np.random.normal(0, 1.2) + mold_ratio * 4.0
    rh = base_rh + np.random.normal(0, 2.5) + dark_spot_ratio * 5.0
    eco2 = base_eco2 + np.random.normal(0, 30.0) + mold_ratio * 1200.0
    tvoc = base_tvoc + np.random.normal(0, 8.0) + mold_ratio * 350.0 + dark_spot_ratio * 150.0

    return np.array([
        np.clip(temp, 15.0, 42.0),
        np.clip(rh, 45.0, 99.0),
        np.clip(eco2, 400.0, 3500.0),
        np.clip(tvoc, 0.0, 1000.0)
    ], dtype=np.float32)

def calculate_shelf_life(is_rotten, dark_spot, mold):
    base_days = 7.5 if not is_rotten else 0.5
    return max(0.0, base_days - dark_spot * 5.0 - mold * 7.0)

def process_local_dataset(data_dir="data", img_size=(64, 64)):
    """
    Processes local fresh and rotten images directly from data/fresh and data/rotten into a multimodal dataset.
    """
    sample_img_dir = os.path.join(data_dir, "sample_images")
    os.makedirs(sample_img_dir, exist_ok=True)

    fresh_dir = os.path.join(data_dir, "fresh")
    rotten_dir = os.path.join(data_dir, "rotten")

    fresh_paths = []
    rotten_paths = []

    for ext in ("*.jpg", "*.jpeg", "*.png", "*.JPG", "*.PNG", "*.webp", "*.WEBP"):
        fresh_paths.extend(glob.glob(os.path.join(fresh_dir, ext)))
        rotten_paths.extend(glob.glob(os.path.join(rotten_dir, ext)))

    print(f"Loaded user dataset: {len(fresh_paths)} Fresh images and {len(rotten_paths)} Rotten images.")

    images = []
    sensors = []
    visual_feats = []
    labels = []
    shelf_lives = []

    # Process Fresh images
    for idx, fpath in enumerate(fresh_paths):
        try:
            img = Image.open(fpath).convert("RGB")
            img_resized = img.resize(img_size)
            img_arr = np.array(img_resized, dtype=np.uint8)
            v_feat = extract_visual_features_from_image(img)

            sensor_arr = generate_correlated_sensors(is_rotten=False, dark_spot_ratio=v_feat[2], mold_ratio=v_feat[3])
            shelf_life = calculate_shelf_life(is_rotten=False, dark_spot=v_feat[2], mold=v_feat[3])

            images.append(img_arr)
            sensors.append(sensor_arr)
            visual_feats.append(v_feat)
            labels.append(0)  # Fresh
            shelf_lives.append(shelf_life)

            if idx < 5:
                img_resized.save(os.path.join(sample_img_dir, f"sample_Fresh_{idx+1}.png"))
        except Exception:
            continue

    # Process Rotten images
    for idx, rpath in enumerate(rotten_paths):
        try:
            img = Image.open(rpath).convert("RGB")
            img_resized = img.resize(img_size)
            img_arr = np.array(img_resized, dtype=np.uint8)
            v_feat = extract_visual_features_from_image(img)

            sensor_arr = generate_correlated_sensors(is_rotten=True, dark_spot_ratio=v_feat[2], mold_ratio=v_feat[3])
            shelf_life = calculate_shelf_life(is_rotten=True, dark_spot=v_feat[2], mold=v_feat[3])

            images.append(img_arr)
            sensors.append(sensor_arr)
            visual_feats.append(v_feat)
            labels.append(1)  # Rotten
            shelf_lives.append(shelf_life)

            if idx < 5:
                img_resized.save(os.path.join(sample_img_dir, f"sample_Rotten_{idx+1}.png"))
        except Exception:
            continue

    images = np.array(images, dtype=np.uint8)
    sensors = np.array(sensors, dtype=np.float32)
    visual_feats = np.array(visual_feats, dtype=np.float32)
    labels = np.array(labels, dtype=np.int64)
    shelf_lives = np.array(shelf_lives, dtype=np.float32)

    npz_path = os.path.join(data_dir, "multimodal_fruit_dataset.npz")
    np.savez_compressed(
        npz_path,
        images=images,
        sensors=sensors,
        visual_feats=visual_feats,
        labels=labels,
        shelf_lives=shelf_lives
    )
    print(f"Successfully processed {len(labels)} user images into '{npz_path}'.")
    return npz_path

if __name__ == "__main__":
    process_local_dataset()

