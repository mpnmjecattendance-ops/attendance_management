---
title: Attendance AI
emoji: 🏢
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
---

# Attendance Management

Attendance management system with:

- `frontend`: React + Vite UI
- `backend`: Express API
- `ai-service`: FastAPI face-recognition service
- `supabase_schema.sql`: database schema, storage buckets, and default settings

## Deployment-ready changes included

- Frontend API calls now use `VITE_API_URL` instead of hardcoded `localhost`
- Backend now accepts `AI_SERVICE_URL` for production deployments
- Backend CORS can be restricted with `CORS_ORIGIN`
- AI service supports `PORT` from the hosting platform
- Added deployable env templates:
  - [`backend/.env.example`](c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\backend\.env.example)
  - [`ai-service/.env.example`](c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\ai-service\.env.example)
  - [`frontend/.env.example`](c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\frontend\.env.example)
- Added [`frontend/vercel.json`](c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\frontend\vercel.json) for SPA routing on Vercel

## Local run

Run each app in its own terminal.

### 1. Supabase

Run [`supabase_schema.sql`](c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\supabase_schema.sql) in the Supabase SQL editor, then seed departments:

```sql
INSERT INTO departments (name)
VALUES
  ('ECE'),
  ('EEE'),
  ('CSE'),
  ('CIVIL'),
  ('MECH'),
  ('IT')
ON CONFLICT (name) DO NOTHING;
```

### 2. AI service

```powershell
cd c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\ai-service
python -m pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

### 3. Backend

```powershell
cd c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\backend
npm install
npm run dev
```

### 4. Frontend

```powershell
cd c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\frontend
npm install
npm run dev
```

Set local env values from the `*.env.example` files before starting the apps.

## Deployment guide

Use [`deployment_guide.md`](c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\deployment_guide.md) for the full Render + Vercel deployment flow.
