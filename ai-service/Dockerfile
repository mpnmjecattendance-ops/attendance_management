# Use Python 3.12 slim image
FROM python:3.12-slim

# Install system dependencies for OpenCV and InsightFace
# These are required to handle image processing and C++ build tools
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    build-essential \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first to leverage Docker cache
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Hugging Face Spaces expects the app to run on port 7860
EXPOSE 7860

# Run the FastAPI app using uvicorn
# We use port 7860 as required by Hugging Face Spaces
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
