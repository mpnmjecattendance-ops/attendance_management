# Root Dockerfile for Hugging Face
FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    build-essential \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Upgrade pip and install build tools (required for insightface/Cython)
RUN pip install --no-cache-dir --upgrade pip setuptools wheel Cython

# Copy requirements from the subfolder
COPY ai-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy everything from the ai-service folder into /app
COPY ai-service/ .

# Hugging Face expects port 7860
EXPOSE 7860

# Run the FastAPI app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
