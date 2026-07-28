#!/usr/bin/env bash
set -Eeuo pipefail

RUNNER_ROOT="${RUNNER_ROOT:-/workspace/salad-gpu-runner}"
RUNNER_VENV="${RUNNER_VENV:-/opt/salad-runner-venv}"
RUNNER_PORT="${RUNNER_PORT:-8888}"
RUNNER_API_URL="${RUNNER_API_URL:-https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/salad-gpu-runner/runner_api.py}"

log() {
  printf '[salad-runner bootstrap] %s\n' "$*"
}

if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  log "Installing Ubuntu packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    procps \
    python3 \
    python3-pip \
    python3-venv \
    unzip \
    zip

  if ! command -v rclone >/dev/null 2>&1; then
    curl -fsSL https://rclone.org/install.sh | bash
  fi

  rm -rf /var/lib/apt/lists/*
else
  log "Not running as root; skipping apt package installation"
fi

mkdir -p "$RUNNER_ROOT/jobs"

log "Downloading runner API from $RUNNER_API_URL"
curl --fail --silent --show-error --location \
  --retry 5 --retry-delay 2 --retry-all-errors \
  "$RUNNER_API_URL" \
  -o "$RUNNER_ROOT/runner_api.py"

if [[ ! -x "$RUNNER_VENV/bin/python" ]]; then
  log "Creating API virtual environment"
  python3 -m venv "$RUNNER_VENV"
fi

log "Installing API dependencies"
"$RUNNER_VENV/bin/python" -m pip install --upgrade pip wheel setuptools
"$RUNNER_VENV/bin/python" -m pip install \
  'fastapi>=0.115,<1' \
  'uvicorn[standard]>=0.30,<1' \
  'python-multipart>=0.0.9,<1' \
  'pydantic>=2.8,<3' \
  'uv>=0.7,<1'

if [[ -z "${RUNNER_API_KEY:-}" ]]; then
  log "ERROR: RUNNER_API_KEY is not set. Add a long random value as a Salad environment variable."
  exit 1
fi

export RUNNER_ROOT RUNNER_VENV RUNNER_PORT
export PYTHONUNBUFFERED=1

log "Starting API on [::]:$RUNNER_PORT"
cd "$RUNNER_ROOT"
exec "$RUNNER_VENV/bin/uvicorn" \
  runner_api:app \
  --host :: \
  --port "$RUNNER_PORT" \
  --workers 1 \
  --proxy-headers \
  --forwarded-allow-ips='*'
