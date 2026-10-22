import io
from types import SimpleNamespace

from PIL import Image
import pytest

from app.services import cv_pipeline


class FakeFaceDetector:
    def __init__(self, faces=None):
        self._faces = faces

    def setInputSize(self, size):
        self.size = size

    def detect(self, image):
        return None, self._faces


class FakeCV2:
    COLOR_RGB2BGR = 1

    @staticmethod
    def cvtColor(image, conversion):
        return image


class FakeYOLO:
    results = [SimpleNamespace(boxes=None)]

    @staticmethod
    def predict(image, classes, conf, verbose):
        return FakeYOLO.results


def _png_bytes():
    image_buffer = io.BytesIO()
    Image.new("RGB", (4, 4)).save(image_buffer, format="PNG")
    return image_buffer.getvalue()


def test_estimate_head_pose_frontal_face_is_attentive():
    # [x, y, w, h, rEye_x, rEye_y, lEye_x, lEye_y, nose_x, nose_y, rMouth_x, rMouth_y, lMouth_x, lMouth_y, score]
    frontal_row = [100, 100, 120, 140, 130, 140, 190, 140, 160, 170, 138, 200, 182, 200, 0.96]
    pose = cv_pipeline.estimate_head_pose(frontal_row)
    assert pose["attentionAvailable"] is True
    assert pose["lookingAway"] is False
    assert abs(pose["yawRatio"]) <= cv_pipeline.YAW_THRESHOLD
    assert cv_pipeline.PITCH_MIN <= pose["pitchRatio"] <= cv_pipeline.PITCH_MAX


def test_estimate_head_pose_sideways_yaw_flags_looking_away():
    # Nose shifted far to the right of the eye midpoint (160 -> 195, inter-eye=60 => yaw=0.583)
    sideways_row = [100, 100, 120, 140, 130, 140, 190, 140, 195, 170, 138, 200, 182, 200, 0.95]
    pose = cv_pipeline.estimate_head_pose(sideways_row)
    assert pose["attentionAvailable"] is True
    assert pose["lookingAway"] is True
    assert pose["yawRatio"] > cv_pipeline.YAW_THRESHOLD


def test_estimate_head_pose_looking_up_pitch_flags_looking_away():
    # Nose very close to eye line (nose_y=145 vs eye_mid_y=140, mouth_mid_y=200 => pitch=0.083 < 0.25)
    looking_up_row = [100, 100, 120, 140, 130, 140, 190, 140, 160, 145, 138, 200, 182, 200, 0.94]
    pose = cv_pipeline.estimate_head_pose(looking_up_row)
    assert pose["attentionAvailable"] is True
    assert pose["lookingAway"] is True
    assert pose["pitchRatio"] < cv_pipeline.PITCH_MIN


def test_estimate_head_pose_zero_distance_is_safe():
    # Coincident eyes (inter-eye distance = 0) -> must not crash
    degenerate_row = [100, 100, 120, 140, 150, 140, 150, 140, 150, 170, 138, 200, 182, 200, 0.8]
    pose = cv_pipeline.estimate_head_pose(degenerate_row)
    assert pose == {
        "lookingAway": False,
        "yawRatio": 0.0,
        "pitchRatio": 0.0,
        "attentionAvailable": False,
    }


def test_analyze_frame_decodes_image_and_returns_empty_detections(monkeypatch):
    monkeypatch.setattr(cv_pipeline, "_load", lambda: None)
    monkeypatch.setattr(cv_pipeline, "_cv2", FakeCV2())
    monkeypatch.setattr(cv_pipeline, "_face", FakeFaceDetector(faces=None))
    monkeypatch.setattr(cv_pipeline, "_yolo", FakeYOLO())

    result = cv_pipeline.analyze_frame(_png_bytes())

    assert result == {
        "faceCount": 0,
        "phoneDetected": False,
        "confidence": 0.0,
        "lookingAway": False,
        "yawRatio": 0.0,
        "pitchRatio": 0.0,
        "attentionAvailable": False,
        "phoneCheckAvailable": True,
    }


def test_analyze_frame_single_and_multiple_faces_uses_largest_face(monkeypatch):
    # Small face looking away, larger primary face looking straight ahead
    small_away = [10, 10, 40, 40, 15, 20, 35, 20, 42, 30, 18, 40, 32, 40, 0.85]
    large_frontal = [100, 100, 120, 140, 130, 140, 190, 140, 160, 170, 138, 200, 182, 200, 0.96]

    monkeypatch.setattr(cv_pipeline, "_load", lambda: None)
    monkeypatch.setattr(cv_pipeline, "_cv2", FakeCV2())
    monkeypatch.setattr(cv_pipeline, "_yolo", FakeYOLO())

    # 1 face (looking away)
    monkeypatch.setattr(cv_pipeline, "_face", FakeFaceDetector(faces=[small_away]))
    one_face = cv_pipeline.analyze_frame(_png_bytes())
    assert one_face["faceCount"] == 1
    assert one_face["lookingAway"] is True

    # 2 faces (largest is frontal -> lookingAway False)
    monkeypatch.setattr(cv_pipeline, "_face", FakeFaceDetector(faces=[small_away, large_frontal]))
    two_faces = cv_pipeline.analyze_frame(_png_bytes())
    assert two_faces["faceCount"] == 2
    assert two_faces["lookingAway"] is False
    assert two_faces["attentionAvailable"] is True


def test_analyze_frame_when_yolo_is_none_reports_phone_check_unavailable(monkeypatch):
    frontal_row = [100, 100, 120, 140, 130, 140, 190, 140, 160, 170, 138, 200, 182, 200, 0.96]
    monkeypatch.setattr(cv_pipeline, "_load", lambda: None)
    monkeypatch.setattr(cv_pipeline, "_cv2", FakeCV2())
    monkeypatch.setattr(cv_pipeline, "_face", FakeFaceDetector(faces=[frontal_row]))
    monkeypatch.setattr(cv_pipeline, "_yolo", None)

    result = cv_pipeline.analyze_frame(_png_bytes())
    assert result["faceCount"] == 1
    assert result["phoneDetected"] is False
    assert result["phoneCheckAvailable"] is False


def test_analyze_frame_rejects_missing_detection_results(monkeypatch):
    monkeypatch.setattr(cv_pipeline, "_load", lambda: None)
    monkeypatch.setattr(cv_pipeline, "_cv2", FakeCV2())
    monkeypatch.setattr(cv_pipeline, "_face", FakeFaceDetector())
    monkeypatch.setattr(cv_pipeline, "_yolo", FakeYOLO())
    monkeypatch.setattr(FakeYOLO, "results", [])

    with pytest.raises(
        cv_pipeline.CVUnavailable,
        match="YOLO did not return object-detection results",
    ):
        cv_pipeline.analyze_frame(_png_bytes())
