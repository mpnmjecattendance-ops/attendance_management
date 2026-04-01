from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import base64
import json
import logging
import os
import threading
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import cv2
import numpy as np
from dotenv import load_dotenv

try:
    from insightface.app import FaceAnalysis
    INSIGHTFACE_IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - handled at runtime
    FaceAnalysis = None
    INSIGHTFACE_IMPORT_ERROR = exc


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("attendance-ai-service")

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
MODEL_NAME = os.environ.get("INSIGHTFACE_MODEL", "buffalo_s")
DETECTION_SIZE = int(os.environ.get("INSIGHTFACE_DET_SIZE", "640"))
CACHE_TTL_SECONDS = int(os.environ.get("EMBEDDING_CACHE_TTL_SECONDS", "300"))
MIN_CANDIDATE_THRESHOLD = float(os.environ.get("MIN_CANDIDATE_THRESHOLD", "0.35"))
MATCH_TOP_K = max(1, int(os.environ.get("MATCH_TOP_K", "3")))
MAX_EMBEDDINGS_PER_STUDENT = max(MATCH_TOP_K, int(os.environ.get("MAX_EMBEDDINGS_PER_STUDENT", "10")))
MIN_MATCH_MARGIN = float(os.environ.get("MIN_MATCH_MARGIN", "0.03"))

MIN_BRIGHTNESS = float(os.environ.get("FACE_MIN_BRIGHTNESS", "0.22"))
MIN_BLUR_VARIANCE = float(os.environ.get("FACE_MIN_BLUR_VARIANCE", "60.0"))
MIN_FACE_AREA_RATIO = float(os.environ.get("FACE_MIN_AREA_RATIO", "0.07"))
MAX_CENTER_OFFSET = float(os.environ.get("FACE_MAX_CENTER_OFFSET", "0.38"))
FACE_CROP_PADDING_RATIO = float(os.environ.get("FACE_QUALITY_PADDING_RATIO", "0.18"))
GUIDE_ELLIPSE_CENTER_X = float(os.environ.get("GUIDE_ELLIPSE_CENTER_X", "0.50"))
GUIDE_ELLIPSE_CENTER_Y = float(os.environ.get("GUIDE_ELLIPSE_CENTER_Y", "0.50"))
GUIDE_ELLIPSE_RADIUS_X = float(os.environ.get("GUIDE_ELLIPSE_RADIUS_X", "0.23"))
GUIDE_ELLIPSE_RADIUS_Y = float(os.environ.get("GUIDE_ELLIPSE_RADIUS_Y", "0.39"))
GUIDE_ELLIPSE_TOLERANCE = float(os.environ.get("GUIDE_ELLIPSE_TOLERANCE", "1.00"))

face_analyzer = None
face_analyzer_lock = threading.Lock()
student_cache_lock = threading.Lock()
student_cache: Dict[str, Dict[str, Any]] = {}
student_cache_loaded_at = 0.0

app = FastAPI(title="AI Attendance Face Recognition API")


class RegisterRequest(BaseModel):
    images: List[str]


class RecognizeRequest(BaseModel):
    image: str
    terminal_id: str = "campus-gate-1"
    enforce_guide: bool = False


class RefreshResponse(BaseModel):
    message: str
    students: int
    embeddings: int
    loaded_at: float


class StudentEntry(Dict[str, Any]):
    pass


def require_supabase_config() -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(status_code=500, detail="Supabase is not configured in the AI service environment.")


def get_face_analyzer() -> FaceAnalysis:
    global face_analyzer

    if INSIGHTFACE_IMPORT_ERROR is not None or FaceAnalysis is None:
        raise HTTPException(
            status_code=500,
            detail=f"InsightFace is not available in the AI service environment: {INSIGHTFACE_IMPORT_ERROR}"
        )

    with face_analyzer_lock:
        if face_analyzer is None:
            logger.info("Loading InsightFace model '%s' with CPU provider, restricting modules", MODEL_NAME)
            # Only load the modules we actually need for attendance
            analyzer = FaceAnalysis(
                name=MODEL_NAME, 
                allowed_modules=['detection', 'recognition', 'landmark_2d_10g'],
                providers=["CPUExecutionProvider"]
            )
            analyzer.prepare(ctx_id=-1, det_size=(DETECTION_SIZE, DETECTION_SIZE))
            face_analyzer = analyzer

    return face_analyzer


def base64_to_cv2(b64_string: str) -> np.ndarray:
    payload = b64_string.split(",", 1)[1] if "," in b64_string else b64_string
    try:
        image_bytes = base64.b64decode(payload)
    except Exception as exc:  # pragma: no cover - invalid input path
        raise HTTPException(status_code=400, detail=f"Invalid base64 image payload: {exc}") from exc

    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if image is None:
        raise HTTPException(status_code=400, detail="Unable to decode image payload.")

    return image


def normalize_embedding(values: np.ndarray) -> np.ndarray:
    vector = np.array(values, dtype=np.float32)
    norm = float(np.linalg.norm(vector))
    if norm == 0.0:
        raise HTTPException(status_code=500, detail="Face embedding could not be normalized.")
    return vector / norm


def parse_embedding(raw_value: Any) -> Optional[np.ndarray]:
    if raw_value is None:
        return None

    if isinstance(raw_value, list):
        vector = np.array(raw_value, dtype=np.float32)
    elif isinstance(raw_value, str):
        stripped = raw_value.strip().strip("[]")
        if not stripped:
            return None
        vector = np.fromstring(stripped, sep=",", dtype=np.float32)
    else:
        return None

    if vector.size == 0:
        return None

    return normalize_embedding(vector)


def normalize_quality_score(raw_value: Any, default: float = 0.5) -> float:
    try:
        score = float(raw_value)
    except (TypeError, ValueError):
        score = default

    return float(np.clip(score, 0.0, 1.0))


def postgrest_get(path: str, query: Dict[str, str]) -> Any:
    require_supabase_config()
    request = Request(
        f"{SUPABASE_URL}/rest/v1/{path}?{urlencode(query)}",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Accept": "application/json"
        }
    )

    try:
        with urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        details = exc.read().decode("utf-8")
        raise HTTPException(status_code=500, detail=f"Supabase query failed: {details}") from exc
    except URLError as exc:
        raise HTTPException(status_code=500, detail=f"Supabase connection failed: {exc.reason}") from exc


def fetch_embedding_rows() -> List[Dict[str, Any]]:
    return postgrest_get(
        "student_face_embeddings",
        {
            "select": "student_id,embedding,quality_score,capture_slot,is_active,students!inner(id,name,is_active)",
            "is_active": "eq.true",
            "students.is_active": "eq.true"
        }
    )


def load_student_cache(force: bool = False) -> Dict[str, Any]:
    global student_cache, student_cache_loaded_at

    with student_cache_lock:
        if not force and student_cache and (time.time() - student_cache_loaded_at) < CACHE_TTL_SECONDS:
            return {
                "students": len(student_cache),
                "embeddings": sum(len(entry["embeddings"]) for entry in student_cache.values()),
                "loaded_at": student_cache_loaded_at
            }

    rows = fetch_embedding_rows()
    next_cache: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        student_info = row.get("students") or {}
        if isinstance(student_info, list):
            student_info = student_info[0] if student_info else {}

        student_id = row.get("student_id") or student_info.get("id")
        if not student_id:
            continue

        parsed_embedding = parse_embedding(row.get("embedding"))
        if parsed_embedding is None:
            continue

        entry = next_cache.setdefault(student_id, {
            "id": student_id,
            "name": student_info.get("name", "Unknown Student"),
            "samples": []
        })

        entry["samples"].append({
            "embedding": parsed_embedding,
            "quality_score": normalize_quality_score(row.get("quality_score"))
        })

    for entry in next_cache.values():
        ranked_samples = sorted(
            entry.get("samples") or [],
            key=lambda sample: sample.get("quality_score", 0.0),
            reverse=True
        )[:MAX_EMBEDDINGS_PER_STUDENT]
        entry["samples"] = ranked_samples
        entry["embeddings"] = [sample["embedding"] for sample in ranked_samples]

    with student_cache_lock:
        student_cache = next_cache
        student_cache_loaded_at = time.time()
        loaded_at = student_cache_loaded_at

    return {
        "students": len(next_cache),
        "embeddings": sum(len(entry["samples"]) for entry in next_cache.values()),
        "loaded_at": loaded_at
    }


def get_cached_students() -> Dict[str, Dict[str, Any]]:
    with student_cache_lock:
        cache_snapshot = dict(student_cache)
        loaded_at = student_cache_loaded_at

    if cache_snapshot and (time.time() - loaded_at) < CACHE_TTL_SECONDS:
        return cache_snapshot

    load_student_cache(force=True)

    with student_cache_lock:
        return dict(student_cache)


def resolve_face_bbox(image: np.ndarray, face: Any, padding_ratio: float = 0.0) -> tuple[int, int, int, int]:
    bbox = np.array(face.bbox).astype(int)
    x1, y1, x2, y2 = bbox.tolist()

    width = max(0, x2 - x1)
    height = max(0, y2 - y1)
    pad_x = int(round(width * padding_ratio))
    pad_y = int(round(height * padding_ratio))

    x1 = max(0, x1 - pad_x)
    y1 = max(0, y1 - pad_y)
    x2 = min(image.shape[1], x2 + pad_x)
    y2 = min(image.shape[0], y2 + pad_y)

    return x1, y1, x2, y2


def extract_face_crop(image: np.ndarray, face: Any, padding_ratio: float = FACE_CROP_PADDING_RATIO) -> np.ndarray:
    x1, y1, x2, y2 = resolve_face_bbox(image, face, padding_ratio)
    crop = image[y1:y2, x1:x2]
    return crop if crop.size else image


def compute_face_center(image: np.ndarray, face: Any) -> tuple[float, float]:
    x1, y1, x2, y2 = resolve_face_bbox(image, face)
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


def compute_guide_distance(image: np.ndarray, face: Any) -> float:
    face_center_x, face_center_y = compute_face_center(image, face)
    normalized_x = (face_center_x / max(float(image.shape[1]), 1.0) - GUIDE_ELLIPSE_CENTER_X) / max(GUIDE_ELLIPSE_RADIUS_X, 1e-6)
    normalized_y = (face_center_y / max(float(image.shape[0]), 1.0) - GUIDE_ELLIPSE_CENTER_Y) / max(GUIDE_ELLIPSE_RADIUS_Y, 1e-6)
    return float(np.sqrt((normalized_x ** 2) + (normalized_y ** 2)))


def is_face_inside_guide(image: np.ndarray, face: Any) -> bool:
    return compute_guide_distance(image, face) <= GUIDE_ELLIPSE_TOLERANCE


def compute_face_quality(image: np.ndarray, face: Any, guide_distance: Optional[float] = None) -> Dict[str, float]:
    face_crop = extract_face_crop(image, face)
    gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
    brightness = float(gray.mean() / 255.0)
    blur_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    x1, y1, x2, y2 = resolve_face_bbox(image, face)

    face_area = max(0, x2 - x1) * max(0, y2 - y1)
    image_area = float(image.shape[0] * image.shape[1]) or 1.0
    face_area_ratio = face_area / image_area

    face_center_x, face_center_y = compute_face_center(image, face)
    image_center_x = image.shape[1] / 2.0
    image_center_y = image.shape[0] / 2.0
    diagonal = np.sqrt((image.shape[1] ** 2) + (image.shape[0] ** 2)) or 1.0
    center_offset = np.sqrt(
        ((face_center_x - image_center_x) ** 2) + ((face_center_y - image_center_y) ** 2)
    ) / diagonal

    brightness_score = min(brightness / max(MIN_BRIGHTNESS, 1e-6), 1.0)
    blur_score = min(blur_variance / max(MIN_BLUR_VARIANCE, 1e-6), 1.0)
    area_score = min(face_area_ratio / max(MIN_FACE_AREA_RATIO, 1e-6), 1.0)
    centered_score = max(
        0.0,
        1.0 - (
            (guide_distance if guide_distance is not None else center_offset) /
            max(GUIDE_ELLIPSE_TOLERANCE if guide_distance is not None else MAX_CENTER_OFFSET, 1e-6)
        )
    )
    quality_score = float(np.clip(
        (0.25 * brightness_score) +
        (0.30 * blur_score) +
        (0.25 * area_score) +
        (0.20 * centered_score),
        0.0,
        1.0
    ))

    metrics = {
        "brightness": brightness,
        "blur_variance": blur_variance,
        "face_area_ratio": face_area_ratio,
        "center_offset": center_offset,
        "quality_score": quality_score
    }
    if guide_distance is not None:
        metrics["guide_distance"] = float(guide_distance)
    return metrics


def validate_face_capture(image: np.ndarray, enforce_guide: bool = False) -> Dict[str, Any]:
    analyzer = get_face_analyzer()
    faces = analyzer.get(image)

    if not faces:
        return {"accepted": False, "reason": "No face detected.", "reason_code": "no_face"}

    if not enforce_guide and len(faces) > 1:
        return {
            "accepted": False,
            "reason": "Multiple faces detected. Please keep only one face in frame.",
            "reason_code": "multiple_faces"
        }

    selected_faces = faces
    guide_distance = None

    if enforce_guide:
        guide_faces = [face for face in faces if is_face_inside_guide(image, face)]
        if not guide_faces:
            return {
                "accepted": False,
                "reason": "Place your face inside the guide circle.",
                "reason_code": "face_not_in_guide"
            }
        if len(guide_faces) > 1:
            return {
                "accepted": False,
                "reason": "Multiple faces are inside the guide circle. Please keep only one face in the circle.",
                "reason_code": "multiple_faces"
            }
        selected_faces = guide_faces

    face = selected_faces[0]
    guide_distance = compute_guide_distance(image, face) if enforce_guide else None
    metrics = compute_face_quality(image, face, guide_distance=guide_distance)

    if metrics["brightness"] < MIN_BRIGHTNESS:
        return {"accepted": False, "reason": "Image is too dark.", "reason_code": "low_brightness", "metrics": metrics}

    if metrics["blur_variance"] < MIN_BLUR_VARIANCE:
        return {"accepted": False, "reason": "Image is too blurry.", "reason_code": "low_sharpness", "metrics": metrics}

    if metrics["face_area_ratio"] < MIN_FACE_AREA_RATIO:
        return {"accepted": False, "reason": "Face is too small in the frame.", "reason_code": "face_too_small", "metrics": metrics}

    if not enforce_guide and metrics["center_offset"] > MAX_CENTER_OFFSET:
        return {"accepted": False, "reason": "Face is not centered clearly enough.", "reason_code": "face_not_centered", "metrics": metrics}

    embedding = getattr(face, "normed_embedding", None)
    if embedding is None:
        embedding = normalize_embedding(face.embedding)

    return {
        "accepted": True,
        "embedding": np.array(embedding, dtype=np.float32),
        "quality_score": metrics["quality_score"],
        "metrics": metrics
    }


def cosine_similarity(vector_a: np.ndarray, vector_b: np.ndarray) -> float:
    return float(np.dot(vector_a, vector_b))


def get_student_samples(student: Dict[str, Any]) -> List[Dict[str, Any]]:
    samples = student.get("samples") or []
    if samples:
        return samples

    embeddings = student.get("embeddings") or []
    return [{
        "embedding": embedding,
        "quality_score": 0.5
    } for embedding in embeddings]


def score_student_match(live_embedding: np.ndarray, student: Dict[str, Any]) -> Optional[Dict[str, float]]:
    samples = get_student_samples(student)
    if not samples:
        return None

    ranked_scores = sorted([
        {
            "similarity": cosine_similarity(live_embedding, sample["embedding"]),
            "quality_score": normalize_quality_score(sample.get("quality_score"))
        }
        for sample in samples
        if sample.get("embedding") is not None
    ], key=lambda item: item["similarity"], reverse=True)

    if not ranked_scores:
        return None

    top_scores = ranked_scores[:max(1, min(MATCH_TOP_K, len(ranked_scores)))]
    similarity_values = np.array([item["similarity"] for item in top_scores], dtype=np.float32)
    quality_weights = np.array(
        [0.5 + (0.5 * item["quality_score"]) for item in top_scores],
        dtype=np.float32
    )
    top_similarity = float(similarity_values[0])
    weighted_mean_similarity = float(np.average(similarity_values, weights=quality_weights))
    confidence = float(np.clip(
        (0.7 * top_similarity) + (0.3 * weighted_mean_similarity),
        0.0,
        1.0
    ))

    return {
        "confidence": confidence,
        "top_similarity": top_similarity,
        "sample_count": float(len(ranked_scores)),
        "top_k_count": float(len(top_scores))
    }


@app.on_event("startup")
async def startup_event() -> None:
    try:
        get_face_analyzer()
        summary = load_student_cache(force=True)
        logger.info("Loaded %s students and %s embeddings into AI cache", summary["students"], summary["embeddings"])
    except Exception as exc:  # pragma: no cover - startup should not stop app entirely
        logger.warning("AI service startup completed with degraded state: %s", exc)


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "cache_loaded": bool(student_cache),
        "cache_students": len(student_cache),
        "cache_age_seconds": 0 if not student_cache_loaded_at else round(time.time() - student_cache_loaded_at, 2)
    }


@app.post("/refresh-cache", response_model=RefreshResponse)
async def refresh_cache() -> RefreshResponse:
    summary = load_student_cache(force=True)
    return RefreshResponse(
        message="Recognition cache refreshed successfully.",
        students=summary["students"],
        embeddings=summary["embeddings"],
        loaded_at=summary["loaded_at"]
    )


@app.post("/register")
async def register(req: RegisterRequest) -> Dict[str, Any]:
    if len(req.images) < 15:
        raise HTTPException(status_code=400, detail="Must provide at least 15 images.")

    accepted: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []

    for index, image_b64 in enumerate(req.images):
        image = base64_to_cv2(image_b64)
        result = validate_face_capture(image)

        if result["accepted"]:
            accepted.append({
                "index": index,
                "embedding": result["embedding"],
                "quality_score": round(float(result["quality_score"]), 6)
            })
        else:
            rejected.append({
                "index": index,
                "reason": result["reason"]
            })

    accepted_sorted = sorted(accepted, key=lambda item: item["quality_score"], reverse=True)
    reference_indexes = [item["index"] for item in accepted_sorted[:3]]

    return {
        "embeddings": [item["embedding"].tolist() for item in accepted],
        "accepted_count": len(accepted),
        "accepted_indexes": [item["index"] for item in accepted],
        "quality_scores": [item["quality_score"] for item in accepted],
        "reference_indexes": reference_indexes,
        "rejected": rejected
    }


@app.post("/recognize")
async def recognize(req: RecognizeRequest) -> Dict[str, Any]:
    image = base64_to_cv2(req.image)
    result = validate_face_capture(image, enforce_guide=req.enforce_guide)

    if not result["accepted"]:
        return {
            "status": result.get("reason_code", "unknown"),
            "message": result["reason"],
            "terminal_id": req.terminal_id
        }

    live_embedding = normalize_embedding(result["embedding"])
    students = get_cached_students()

    if not students:
        raise HTTPException(status_code=500, detail="No active student embeddings are loaded in the AI cache.")

    best_match_id: Optional[str] = None
    best_match_name: Optional[str] = None
    best_score = -1.0
    best_top_similarity = -1.0
    second_best_score = -1.0

    for student_id, student in students.items():
        match = score_student_match(live_embedding, student)
        if match is None:
            continue

        student_score = match["confidence"]

        if student_score > best_score:
            second_best_score = best_score
            best_score = student_score
            best_match_id = student_id
            best_match_name = student.get("name")
            best_top_similarity = match["top_similarity"]
        elif student_score > second_best_score:
            second_best_score = student_score

    if best_match_id is None or best_score < MIN_CANDIDATE_THRESHOLD:
        return {
            "status": "unknown",
            "message": "No reliable face match was found.",
            "confidence": round(float(max(best_score, 0.0)), 6),
            "terminal_id": req.terminal_id
        }

    runner_up_confidence = round(float(max(second_best_score, 0.0)), 6)
    score_margin = round(float(best_score - max(second_best_score, 0.0)), 6)

    if second_best_score >= MIN_CANDIDATE_THRESHOLD and score_margin < MIN_MATCH_MARGIN:
        return {
            "status": "ambiguous",
            "message": "Face match is too close to another student and needs review.",
            "student_id": best_match_id,
            "name": best_match_name,
            "confidence": round(float(best_score), 6),
            "best_similarity": round(float(best_top_similarity), 6),
            "runner_up_confidence": runner_up_confidence,
            "score_margin": score_margin,
            "terminal_id": req.terminal_id
        }

    return {
        "status": "recognized",
        "student_id": best_match_id,
        "name": best_match_name,
        "confidence": round(float(best_score), 6),
        "best_similarity": round(float(best_top_similarity), 6),
        "runner_up_confidence": runner_up_confidence,
        "score_margin": score_margin,
        "terminal_id": req.terminal_id
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8001")))

