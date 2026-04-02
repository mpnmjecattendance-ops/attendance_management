# Windows 10 Production Deployment (24/7 Live PC)

Follow these steps to deploy on a Windows 10 desktop or server.

## 1. Professional Prerequisites
Before starting, ensure these are installed:
- [Node.js (LTS Version)](https://nodejs.org/en/download/)
- [Python 3.12 (Add to PATH)](https://www.python.org/downloads/release/python-31213/)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Often needed for Python AI libraries).

## 2. Setup folders (Run once)
Open **PowerShell as Administrator** and navigate to your project folder:

```powershell
# 1. AI Service
cd ai-service
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
deactivate
cd ..

# 2. Backend
cd backend
npm install
cd ..

# 3. Frontend
cd frontend
npm install
npm run build
cd ..
```

## 3. Launching with PM2
We use an `ecosystem.config.js` to manage all services at once.

```powershell
# 1. Install PM2
npm install -g pm2

# 2. Start all services
pm2 start ecosystem.config.js
```

## 4. Ensure Auto-Start on Windows Boot
By default, PM2 stops if the computer restarts. To fix this on Windows 10:

1. Install the startup script:
   ```powershell
   npm install -g pm2-windows-startup
   pm2-startup install
   ```
2. Save your running list:
   ```powershell
   pm2 save
   ```

## 5. Expose Securely (Cloudflare Tunnel)
You should NOT use port forwarding (it's risky). Use **Cloudflare Tunnel** instead:

1. Download [`cloudflared.exe`](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) for Windows.
2. In the [Cloudflare Dashboard](https://dash.cloudflare.com/), go to **Zero Trust** -> **Tunnels** -> **Create a Tunnel**.
3. Point your public domain to these local addresses:
   - `attendance.yourdomain.com` -> `http://localhost:3000` (Frontend)
   - `api.yourdomain.com` -> `http://localhost:5000` (Backend)
   - `ai.yourdomain.com` -> `http://localhost:8000` (AI Service)

## 6. Maintenance Checklist
- **Check Status**: `pm2 status`
- **View Logs**: `pm2 logs` (Check for errors in real-time)
- **Restart All**: `pm2 restart all`
- **Update frontend**: After changing frontend code, run `npm run build` and `pm2 restart frontend`.
