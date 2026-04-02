module.exports = {
  apps: [
    {
      name: 'ai-service',
      cwd: './ai-service',
      script: './venv/Scripts/python.exe',
      args: '-m uvicorn main:app --host 0.0.0.0 --port 8001',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        PORT: 8001
      }
    },
    {
      name: 'backend-api',
      cwd: './backend',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 5000
      }
    },
    {
      name: 'frontend',
      cwd: './frontend',
      script: 'npx',
      args: 'serve -s dist -l 3000',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
