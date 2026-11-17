# OpenVoice

Free, open-source alternative to ElevenLabs built on publik. Generate speech with Kokoro and Chatterbox, design voices from descriptions, clone voices with consent, and watermark every audio file.

## Quick Start

```sh
npm install
npm start
```

Open `http://localhost:3001`.

## API

- `GET /api/voices`
- `POST /api/tts`
- `POST /api/voices/design`
- `POST /api/voices/clone`
- `POST /api/watermark/verify`
