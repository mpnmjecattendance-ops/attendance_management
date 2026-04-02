# Deployment Guide: Low-Budget Online Setup

This project uses a "Zero-Cost" strategy by splitting services across platforms:

- `ai-service` on **Hugging Face Spaces** (FREE 16GB RAM)
- `backend` on **Render** (FREE Node.js)
- `frontend` on **Vercel** (FREE Static)
- database and storage on **Supabase** (FREE Tier)

---

## 1. Prepare Supabase (The Foundation)
1.  Open your **Supabase Dashboard** -> **SQL Editor**.
2.  Paste and run your [`supabase_schema.sql`](file:///c:/Users/dhine/Desktop/ATTENDANCE_MANAGEMENT/supabase_schema.sql).
3.  Copy these two values for later:
    *   `SUPABASE_URL`
    *   `SUPABASE_SERVICE_ROLE_KEY`

---

## 2. Deploy AI Service (Hugging Face)
*Hugging Face offers 16GB RAM for FREE, which is required for face recognition models.*

1.  **Create a New Space** on [Hugging Face](https://huggingface.co/).
2.  **SDK Options:** Select **Docker** (Blank).
3.  **Upload Files:** Go to "Files and versions" and upload everything inside your local [`ai-service`](file:///c:/Users/dhine/Desktop/ATTENDANCE_MANAGEMENT/ai-service) folder (including the [`Dockerfile`](file:///c:/Users/dhine/Desktop/ATTENDANCE_MANAGEMENT/ai-service/Dockerfile) I just created).
4.  **Add Secrets:** Go to **Settings** -> **Variables and secrets**. Add:
    *   `SUPABASE_URL`
    *   `SUPABASE_SERVICE_ROLE_KEY`
5.  **Get URL:** Once it builds, copy the App URL (e.g., `https://username-space-name.hf.space`).

---

## 3. Deploy Backend (Render)
*Render handles the API logic that talks to the AI and Database.*

1.  Create a new **Web Service** on [Render](https://dashboard.render.com/).
2.  Connect your GitHub repo and set the **Root Directory** = `backend`.
3.  **Settings:**
    *   Runtime: `Node`
    *   Build Command: `npm install`
    *   Start Command: `node server.js`
4.  **Environment Variables:**
    *   `SUPABASE_URL`
    *   `SUPABASE_SERVICE_ROLE_KEY`
    *   `AI_SERVICE_URL` = **Paste your Hugging Face URL from Step 2**
    *   `ADMIN_EMAIL` / `ADMIN_PASSWORD` (Example credentials)
    *   `CORS_ORIGIN` = (Leave blank for now, then update after Vercel is live).

---

## 4. Deploy Frontend (Vercel)
*Vercel hosts the user interface.*

1.  New Project on [Vercel](https://vercel.com/dashboard).
2.  Root Directory = `frontend`.
3.  **Environment Variable:**
    *   `VITE_API_URL` = **Paste your Render URL from Step 3**
4.  Vercel will give you a public URL (e.g. `https://my-app.vercel.app`).

---

## 5. Final Step: Secure your CORS
1.  Go back to your **Render Backend** settings.
2.  Update the `CORS_ORIGIN` env var to your actual **Vercel URL**.
3.  Redeploy.

---

## Testing Plan
1.  **Check AI:** Open `https://hf-space-url.hf.space/health`
2.  **Check Backend:** Open `https://render-url.onrender.com/health`
3.  **Check Frontend:** Open your Vercel link and try to log in!

