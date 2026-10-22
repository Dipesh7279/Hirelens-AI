# HireLens AI — Setup & Implementation Guide

## 1. Prerequisites
- Node.js (v18.x+) & npm
- Python (3.10+) & pip
- MongoDB running on port 27017 (`mongodb://127.0.0.1:27017/ai_recruitment`)
- Gemini API Key from Google AI Studio

## 2. Environment Configuration
From the project folder: `HireLens-AI-main/ai-recruitment-integrated/ai-recruitment/`

- Backend: Copy `backend/.env.example` -> `backend/.env`
- AI Service: Copy `ai-service/.env.example` -> `ai-service/.env` (insert your `GEMINI_API_KEY`)
- Frontend: Copy `frontend/.env.example` -> `frontend/.env`

## 3. Run the Services (3 Terminals)

# Terminal 1: AI Service (Port 8000)
cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1       # On Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000 --reload

# Terminal 2: Backend (Port 5000)
cd backend
npm install
npm run dev

# Terminal 3: Frontend (Port 5173)
cd frontend
npm install
npm run dev

Open browser: http://localhost:5173
