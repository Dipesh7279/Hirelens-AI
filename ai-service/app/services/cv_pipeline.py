import io
import math
import os
import threading
from pathlib import Path
from typing import Any, Protocol, Sequence, TypeGuard

import numpy as np
from PIL import Image

_lock = threading.Lock()
_face = None
_yolo = None
_yolo_attempted = False
_cv2 = None
COCO_CELL_PHONE = 67
PHONE_MIN_CONF = 0.45
FACE_MIN_CONF = 0.5
YAW_THRESHOLD = 0.35
PITCH_MIN = 0.25
PITCH_MAX = 0.80
YUNET_MODEL = (
    Path(__file__).resolve().parents[2]
    / "models"
    / "face_detection_yunet_2026may.onnx"
)


class CVUnavailable(RuntimeError):
    pass


class _DetectionResult(Protocol):
    boxes: Any


def _is_detection_result(result: object) -> TypeGuard[_DetectionResult]:
    return hasattr(result, "boxes")


def estimate_head_pose(face_row: Sequence[float]) -> dict:
    """Estimate head-pose attention proxy from a YuNet 15-element face row.

    YuNet row format:
    [x, y, w, h, rEye_x, rEye_y, lEye_x, lEye_y, nose_x, nose_y, rMouth_x, rMouth_y, lMouth_x, lMouth_y, score]
    Note: This is a coarse landmark-based head-pose proxy, not eye-gaze tracking or emotion analysis.
    """
    if face_row is None or len(face_row) < 14:
        return {
            "lookingAway": False,
            "yawRatio": 0.0,
            "pitchRatio": 0.0,
            "attentionAvailable": False,
        }

    r_eye_x, r_eye_y = float(face_row[4]), float(face_row[5])
    l_eye_x, l_eye_y = float(face_row[6]), float(face_row[7])
    nose_x, nose_y = float(face_row[8]), float(face_row[9])
    r_mouth_x, r_mouth_y = float(face_row[10]), float(face_row[11])
    l_mouth_x, l_mouth_y = float(face_row[12]), float(face_row[13])

    inter_eye_distance = math.hypot(l_eye_x - r_eye_x, l_eye_y - r_eye_y)
    eye_mid_x = (r_eye_x + l_eye_x) / 2.0
    eye_mid_y = (r_eye_y + l_eye_y) / 2.0
    mouth_mid_y = (r_mouth_y + l_mouth_y) / 2.0
    eye_to_mouth_y = mouth_mid_y - eye_mid_y

    if inter_eye_distance <= 1e-6 or abs(eye_to_mouth_y) <= 1e-6:
        return {
            "lookingAway": False,
            "yawRatio": 0.0,
            "pitchRatio": 0.0,
            "attentionAvailable": False,
        }

    yaw_ratio = (nose_x - eye_mid_x) / inter_eye_distance
    pitch_ratio = (nose_y - eye_mid_y) / eye_to_mouth_y
    looking_away = (
        abs(yaw_ratio) > YAW_THRESHOLD
        or pitch_ratio < PITCH_MIN
        or pitch_ratio > PITCH_MAX
    )

    return {
        "lookingAway": bool(looking_away),
        "yawRatio": round(float(yaw_ratio), 3),
        "pitchRatio": round(float(pitch_ratio), 3),
        "attentionAvailable": True,
    }


def _load():
    global _cv2, _face, _yolo, _yolo_attempted
    if _cv2 is not None and _face is not None and _yolo_attempted:
        return
    with _lock:
        if _cv2 is not None and _face is not None and _yolo_attempted:
            return
        try:
            os.environ.setdefault("OPENCV_FORCE_DNN_ENGINE", "4")
            import cv2

            _cv2 = cv2
        except ImportError as e:
            raise CVUnavailable("OpenCV is not installed. Run: pip install -r requirements.txt") from e

        if not _yolo_attempted:
            _yolo_attempted = True
            try:
                from ultralytics import YOLO

                if _yolo is None:
                    _yolo = YOLO("yolov8n.pt")  # auto-downloads ~6MB on first run
            except Exception:
                _yolo = None

        if not YUNET_MODEL.is_file():
            raise CVUnavailable(f"YuNet model file not found: {YUNET_MODEL}")

        try:
            if _face is None:
                _face = cv2.FaceDetectorYN.create(
                    str(YUNET_MODEL),
                    "",
                    (320, 320),
                    FACE_MIN_CONF,
                    0.3,
                    5000,
                )
        except cv2.error as e:
            raise CVUnavailable(
                f"Could not load the YuNet model at {YUNET_MODEL}: {e}"
            ) from e

        if _face is None:
            raise CVUnavailable(f"OpenCV could not create a YuNet detector from {YUNET_MODEL}")


def analyze_frame(image_bytes: bytes) -> dict:
    _load()
    face, cv2, yolo = _face, _cv2, _yolo
    assert face is not None and cv2 is not None

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    arr = np.asarray(img)

    with _lock:  # OpenCV and Ultralytics model objects are not thread-safe
        height, width = arr.shape[:2]
        face.setInputSize((width, height))
        _, faces = face.detect(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR))
        face_count = 0 if faces is None else len(faces)

        pose = {
            "lookingAway": False,
            "yawRatio": 0.0,
            "pitchRatio": 0.0,
            "attentionAvailable": False,
        }
        if faces is not None and len(faces) > 0:
            largest_face = max(faces, key=lambda row: float(row[2]) * float(row[3]))
            pose = estimate_head_pose(largest_face)

        confs = []
        if yolo is not None:
            predictions = yolo.predict(
                arr, classes=[COCO_CELL_PHONE], conf=PHONE_MIN_CONF, verbose=False
            )
            yolo_result = next(iter(predictions), None)
            if yolo_result is None or not _is_detection_result(yolo_result):
                raise CVUnavailable("YOLO did not return object-detection results")

            boxes = yolo_result.boxes
            confs = (
                [float(confidence) for confidence in boxes.conf.tolist()]
                if boxes is not None and boxes.conf is not None
                else []
            )

    return {
        "faceCount": face_count,
        "phoneDetected": bool(confs),
        "confidence": round(max(confs), 3) if confs else 0.0,
        "lookingAway": pose["lookingAway"],
        "yawRatio": pose["yawRatio"],
        "pitchRatio": pose["pitchRatio"],
        "attentionAvailable": pose["attentionAvailable"],
        "phoneCheckAvailable": yolo is not None,
    }
