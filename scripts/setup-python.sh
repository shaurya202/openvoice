#!/usr/bin/env bash
# Create .venv and install Kokoro, Chatterbox, and faster-whisper.
# The server prefers .venv/bin/python. Override with PYTHON_BIN.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required. The server does not spawn the 'python' command." >&2
  exit 1
fi

missing=()
command -v espeak-ng >/dev/null 2>&1 || missing+=("espeak-ng")
command -v ffmpeg >/dev/null 2>&1 || missing+=("ffmpeg")
if ((${#missing[@]})); then
  echo "Install system packages first: ${missing[*]}" >&2
  echo "  Debian/Ubuntu: sudo apt-get install -y espeak-ng ffmpeg" >&2
  exit 1
fi

python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt

echo
echo "Python worker is ready."
echo "  interpreter: $(pwd)/.venv/bin/python"
echo "  override:    PYTHON_BIN=/path/to/python npm start"
echo "First synthesis downloads Kokoro, Chatterbox, and Whisper weights from Hugging Face."
echo "Kokoro and consent checks run on CPU. Chatterbox runs on CPU and is faster with a CUDA GPU."
