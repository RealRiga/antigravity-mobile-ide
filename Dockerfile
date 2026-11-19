# Antigravity Mobile IDE — Cloud & Local Container Image
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    AGY_WORKSPACE_DIR=/workspace/antigravity-mobile-ide

# Install git and basic CLI tools for mobile Git operations and agent shell tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/antigravity-mobile-ide

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Initialize git inside container workspace if not mounted
RUN git config --global user.email "mobile@antigravity.local" && \
    git config --global user.name "Antigravity Mobile Agent" && \
    git config --global --add safe.directory '*'

EXPOSE 8000

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

