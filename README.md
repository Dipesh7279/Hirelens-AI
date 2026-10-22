# AI Recruitment Platform

- `backend/`    Node/Express: auth, resume parsing, and private resume storage (MongoDB GridFS)
- `frontend/`   React + Vite + Tailwind
- `ai-service/` FastAPI: resume extraction, Gemini structuring, authenticity check

## Setup
```bash
# 1. Backend
cd backend && cp .env.example .env   # fill in secrets
npm install && npm run dev           # :5000

# 2. AI service
cd ai-service && cp .env.example .env
python -m venv .venv
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000

# 3. Frontend
cd frontend && npm install && npm run dev   # :5173
```
Flow: candidate (JWT) -> `POST /api/resume/parse` (multipart, field `file`) -> FastAPI `/resume/parse`.
For Gemini resume structuring, set a valid `GEMINI_API_KEY` and a text-generation
model supported by your Google AI Studio project in `ai-service/.env`. The
current default is `gemini-3.8-flash`. Gemini requests use the Interactions
API for JSON output and set `store=false`, so resume text is not retained as a
stored interaction. If `GEMINI_MODEL` is set to the retired
`gemini-2.5-flash`, the service retries once with the current default after a
model-not-found response. When Gemini is temporarily unavailable (for example,
quota/rate limits), parsing deliberately uses the disclosed heuristic fallback
instead of failing the resume upload.

Resume originals are stored in the MongoDB database configured by `MONGO_URI`,
using GridFS collections (`resumes.files` and `resumes.chunks`). Files are
uploaded from memory and are not written to backend local disk. MongoDB stores
the file and its metadata; candidate profiles retain the GridFS file ID and
resume details. Downloads remain behind the authenticated, ownership-checked
backend route. No separate resume-storage account or credentials are required.
Check your MongoDB Atlas storage and data-transfer limits before uploading
resumes; files consume the database's storage quota. Existing files in
Cloudinary are not migrated or deleted by this change; those files must be
migrated or uploaded again before existing profiles can download them.

The backend requires `MONGO_URI` and now stops instead of silently switching to
a separate local persistent database when that configured database is
unavailable. This prevents accounts from being created in a hidden, per-machine
database. `/api/health` is the liveness endpoint and `/api/ready` reports whether
the configured database connection is ready.

Resume replacement deletes the prior object after the new profile is saved.
Failed profile writes trigger best-effort removal of the newly uploaded object.
There is not yet an account-deletion or automatic resume-retention workflow;
configure retention at the product level before production use.

Checks (PowerShell): `cd backend; npm test`; `cd ai-service; .\.venv\Scripts\python.exe -m pytest -q`; `cd frontend; npm run build`.

The AI service's frame-integrity endpoint uses OpenCV YuNet for face counting
and YOLOv8 for phone detection. The YuNet ONNX model is included in
`ai-service/models/`; the first phone-detection request downloads `yolov8n.pt`.
The CV dependencies support Python 3.10-3.14.
