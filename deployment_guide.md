# Deployment Guide

This project is best deployed as:

- `ai-service` on Render
- `backend` on Render
- `frontend` on Vercel
- database and storage on Supabase

## 1. Prepare Supabase first

1. Open Supabase SQL Editor.
2. Run [`supabase_schema.sql`](c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\supabase_schema.sql).
3. Seed the default departments:

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

4. Copy these Supabase values because both backend and AI service need them:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

## 2. Deploy the AI service on Render

Create a new Web Service on Render using the `ai-service` folder.

- Root Directory: `ai-service`
- Runtime: `Python`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

Set these environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PORT` is managed by Render automatically

The repo now includes [`ai-service/.python-version`](c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\ai-service\.python-version) to pin the service to Python `3.12.13`, which is safer for the AI dependencies than relying on Render's changing default Python version.

Optional tuning env vars are already listed in [`ai-service/.env.example`](c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\ai-service\.env.example).

After deployment, open:

- `https://your-ai-service.onrender.com/health`

Keep this live URL. The backend needs it as `AI_SERVICE_URL`.

## 3. Deploy the backend on Render

Create another Web Service on Render using the `backend` folder.

- Root Directory: `backend`
- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `node server.js`

Set these environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `AI_SERVICE_URL`
  Use the deployed Render URL from step 2
- `CORS_ORIGIN`
  You can leave this empty for the first deploy. After Vercel is live, set it to the exact frontend URL and redeploy the backend.
- `MIN_ACCEPTED_ENROLLMENT_IMAGES=8`
- `STUDENT_REFERENCE_BUCKET=student-reference-faces`
- `REVIEW_FACE_BUCKET=recognition-review-faces`
- `NOTIFICATION_COUNTRY_CODE=+91`

Optional Twilio variables:

- `TWILIO_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

After deployment, verify:

- `https://your-backend.onrender.com/health`

## 4. Deploy the frontend on Vercel

Import the repository into Vercel and set the project root to `frontend`.

Recommended settings:

- Framework Preset: `Vite`
- Root Directory: `frontend`
- Build Command: `npm run build`
- Output Directory: `dist`

Set this environment variable:

- `VITE_API_URL=https://your-backend.onrender.com`

Add it at least for the `Production` environment. If you also want Vercel preview deployments to work correctly, add the same variable for `Preview` too.

This project does not currently need frontend Supabase env vars because the frontend talks to the backend, not directly to Supabase.

The included [`frontend/vercel.json`](c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\frontend\vercel.json) handles SPA route rewrites so routes like `/admin/reports` work after refresh.

## 5. Final wiring

Once Vercel gives you the frontend URL:

1. Go back to the backend service on Render.
2. Set `CORS_ORIGIN=https://your-frontend.vercel.app`
3. Save and redeploy the backend.

## 6. Post-deploy checklist

Check these URLs:

- Frontend home page loads
- Backend health responds at `/health`
- AI service health responds at `/health`

Then test this real flow:

1. Admin login
2. Register a student with 15 face images
3. Open `/capture` or `/kiosk`
4. Confirm attendance is created
5. Open `/admin/reports`
6. Open `/admin/settings`

## 7. Common issues

### Frontend loads but API calls fail

- `VITE_API_URL` is wrong
- backend `CORS_ORIGIN` does not match the exact Vercel URL
- backend was not redeployed after env changes

### Student registration fails

- `AI_SERVICE_URL` is wrong in backend
- AI service failed to boot its model
- Supabase service-role key is missing or invalid

### Review images or reference images do not upload

- confirm [`supabase_schema.sql`](c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\supabase_schema.sql) was run fully
- it creates the `student-reference-faces` and `recognition-review-faces` storage buckets

### Render service starts but crashes

- missing required env vars
- wrong start command
- Python or Node dependencies did not install fully

## 8. Env files to copy from

- [`backend/.env.example`](c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\backend\.env.example)
- [`ai-service/.env.example`](c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\ai-service\.env.example)
- [`frontend/.env.example`](c:\Users\dhine\Desktop\ATTENDANCE_MANAGEMENT\frontend\.env.example)
