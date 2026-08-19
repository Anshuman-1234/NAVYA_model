import torch
import torch.nn as nn
import torch.nn.functional as F

class ImageOnlyModel(nn.Module):
    """
    Single-modality Vision Model for Tomato Quality Classification using visual feature vectors + image ConvNet.
    """
    def __init__(self, visual_in=5, num_classes=2):
        super(ImageOnlyModel, self).__init__()
        self.visual_encoder = nn.Sequential(
            nn.Linear(visual_in, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(64, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU()
        )
        self.classifier = nn.Linear(64, num_classes)

    def forward(self, vis_x):
        feat = self.visual_encoder(vis_x)
        out = self.classifier(feat)
        return out


class SensorOnlyModel(nn.Module):
    """
    Single-modality MLP Model for Environmental Telemetry [Temp, Humidity, eCO2, TVOC].
    """
    def __init__(self, in_features=4, num_classes=2):
        super(SensorOnlyModel, self).__init__()
        self.net = nn.Sequential(
            nn.Linear(in_features, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(64, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, num_classes)
        )

    def forward(self, x):
        return self.net(x)


class GatedMultimodalFusionUnit(nn.Module):
    """
    Adaptive Feature Gating Unit dynamically balancing visual embeddings and sensor embeddings.
    Allows the network to trust sensors when gas spikes occur (high TVOC/eCO2) or trust images
    when visual surface defects appear.
    """
    def __init__(self, img_dim=64, sensor_dim=64, fused_dim=128):
        super(GatedMultimodalFusionUnit, self).__init__()
        self.proj_img = nn.Linear(img_dim, fused_dim)
        self.proj_sensor = nn.Linear(sensor_dim, fused_dim)
        
        # Gate network z = sigmoid(W * [img_proj, sensor_proj])
        self.gate_net = nn.Sequential(
            nn.Linear(fused_dim * 2, fused_dim),
            nn.Sigmoid()
        )
        
    def forward(self, img_emb, sensor_emb):
        h_img = F.relu(self.proj_img(img_emb))
        h_sensor = F.relu(self.proj_sensor(sensor_emb))
        
        concat_feat = torch.cat([h_img, h_sensor], dim=1)
        z = self.gate_net(concat_feat)  # Dynamic gating coefficient between 0 and 1
        
        # Convex combination of visual and sensor features
        fused = z * h_img + (1.0 - z) * h_sensor
        return fused, z


class MultimodalFusionModel(nn.Module):
    """
    Deep Multimodal Fusion Model integrating Vision Extractor and Sensor Encoder
    with an adaptive Feature Gating Unit and Joint Classification & Regression Heads.
    """
    def __init__(self, visual_in=5, sensor_in=4, num_classes=2):
        super(MultimodalFusionModel, self).__init__()
        
        # 1. Vision Feature Extractor
        self.visual_encoder = nn.Sequential(
            nn.Linear(visual_in, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Linear(64, 64),
            nn.ReLU()
        )
        
        # 2. Sensor Feature Extractor
        self.sensor_encoder = nn.Sequential(
            nn.Linear(sensor_in, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Linear(64, 64),
            nn.ReLU()
        )
        
        # 3. Gated Fusion Unit
        self.fusion_unit = GatedMultimodalFusionUnit(img_dim=64, sensor_dim=64, fused_dim=128)
        
        # 4. Joint Head Classifier & Regressor
        self.joint_dense = nn.Sequential(
            nn.Linear(128 + 64 + 64, 128), # Fused + Vis + Sensor residual skip
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(128, 64),
            nn.ReLU()
        )
        
        # Multi-task heads
        self.classifier = nn.Linear(64, num_classes)
        self.regressor = nn.Linear(64, 1)  # Remaining shelf life in days

    def forward(self, vis_x, sensor_x):
        # Extract visual embedding
        v_emb = self.visual_encoder(vis_x)
        
        # Extract sensor embedding
        s_emb = self.sensor_encoder(sensor_x)
        
        # Gated multimodal fusion
        fused_emb, gate_weights = self.fusion_unit(v_emb, s_emb)
        
        # Combine fused embedding with original modal embeddings (Residual Fusion Connection)
        combined = torch.cat([fused_emb, v_emb, s_emb], dim=1)
        latent = self.joint_dense(combined)
        
        logits = self.classifier(latent)
        shelf_life_pred = self.regressor(latent)
        
        return logits, shelf_life_pred, gate_weights
