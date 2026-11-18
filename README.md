# OpenVoice

Free, open-source alternative to ElevenLabs built on publik. Generate speech with Kokoro and Chatterbox, design voices from descriptions, clone voices with consent, and watermark every audio file.

## Quick Start

```sh
npm install
npm start
```

Open `http://localhost:3001`.

Speech synthesis uses a Python worker. Without it, `/api/tts` returns an error instead of a placeholder tone. Browser Kokoro can still speak on the Studio tab once the page can download the model.

## Speech setup

Kokoro (server), Chatterbox (expressive voices and clones), and consent transcription need Python 3, `espeak-ng`, and `ffmpeg`.

```sh
# Debian/Ubuntu
sudo apt-get install -y espeak-ng ffmpeg
bash scripts/setup-python.sh
```

The script creates `.venv` and installs `requirements.txt` (Kokoro, Chatterbox, faster-whisper). The server uses `.venv/bin/python` when `PYTHON_BIN` is unset. On a machine where only `python3` exists, that interpreter is used; the server does not spawn a missing `python` command.

```sh
PYTHON_BIN=/path/to/python npm start
```

The first synthesis downloads model weights from Hugging Face. Kokoro and the consent check run on CPU. Chatterbox also runs on CPU (several GB of RAM) and is much faster with a CUDA GPU. Set `OPENVOICE_WHISPER_MODEL` to change the consent model (default `base.en`).

Browser Kokoro uses the kokoro-js web build (WASM). WebGPU is used only when `navigator.gpu.requestAdapter()` returns an adapter. A failed browser load is shown in the studio status; the page then tries the Python worker and surfaces that error too.

## Voice cloning

Cloning needs a reference clip and a separate recording of the speaker saying:

> I consent to cloning my voice on OpenVoice

The recording is transcribed locally and must match that phrase. A checkbox without a matching recording is rejected. A saved clone is synthesized with Chatterbox, using the reference clip as the audio prompt.

## API

- `GET /api/voices`
- `GET /api/health` — includes `tts.kokoro`, `tts.chatterbox`, and `tts.stt`
- `POST /api/tts`
- `POST /api/voices/design`
- `POST /api/voices/clone`
- `POST /api/watermark/verify`
