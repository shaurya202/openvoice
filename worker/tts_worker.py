"""Python TTS worker for Kokoro and Chatterbox.

Usage:
  python3 worker/tts_worker.py --engine kokoro --text "Hello" --voice af_heart --out out.wav
  python3 worker/tts_worker.py --engine chatterbox --text "Hello" --out out.wav --ref-audio ref.wav

Exit code 2 means a required package is not installed. Other failures exit 1.
The Node server surfaces stderr instead of substituting a tone.
"""
import argparse
import os
import sys
import traceback

import numpy as np


def fail_missing(package: str, exc: BaseException) -> None:
    print(
        f"{package} is not installed ({exc}). "
        "Run scripts/setup-python.sh, or pip install -r requirements.txt. "
        "Set PYTHON_BIN if the server should use a different interpreter.",
        file=sys.stderr,
    )
    sys.exit(2)


def run_kokoro(text: str, voice: str, speed: float, out_path: str) -> None:
    try:
        from kokoro import KPipeline
        import soundfile as sf
        import torch
    except ImportError as exc:
        fail_missing("kokoro (and soundfile/torch)", exc)

    lang = voice[0] if voice and voice[0] in "ab" else "a"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    pipeline = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M", device=device)
    chunks = []
    for item in pipeline(text, voice=voice, speed=speed):
        audio = getattr(item, "audio", None)
        if audio is None:
            audio = item[2]
        if audio is None:
            continue
        if hasattr(audio, "detach"):
            audio = audio.detach().cpu().numpy()
        audio = np.asarray(audio, dtype=np.float32).reshape(-1)
        if audio.size:
            chunks.append(audio)
    if not chunks:
        raise RuntimeError("Kokoro produced no audio")
    sf.write(out_path, np.concatenate(chunks), 24000, subtype="PCM_16")


def run_chatterbox(text: str, ref_audio: str | None, out_path: str) -> None:
    try:
        import torch
        import torchaudio
        import perth
        from perth.dummy_watermarker import DummyWatermarker

        # Older setups miss pkg_resources, so perth leaves this class as None and Chatterbox crashes.
        if getattr(perth, "PerthImplicitWatermarker", None) is None:
            perth.PerthImplicitWatermarker = DummyWatermarker
            print(
                "Chatterbox audio watermark model is unavailable; continuing without it. "
                "OpenVoice still embeds its own watermark. Install setuptools<81 if you want Perth.",
                file=sys.stderr,
            )
        from chatterbox.tts import ChatterboxTTS
    except ImportError as exc:
        fail_missing("chatterbox-tts (and torchaudio)", exc)

    if ref_audio and not os.path.exists(ref_audio):
        raise RuntimeError(f"reference audio not found: {ref_audio}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading Chatterbox on {device}", file=sys.stderr)
    model = ChatterboxTTS.from_pretrained(device=device)
    if ref_audio:
        print(f"Using reference audio {ref_audio}", file=sys.stderr)
        wav = model.generate(text, audio_prompt_path=ref_audio)
    else:
        wav = model.generate(text)
    if wav.dim() == 1:
        wav = wav.unsqueeze(0)
    torchaudio.save(out_path, wav.cpu(), model.sr, encoding="PCM_S", bits_per_sample=16)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["kokoro", "chatterbox"], required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--ref-audio", default=None)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    text = " ".join(args.text.split())
    if not text:
        raise RuntimeError("No speakable text")

    if args.engine == "kokoro":
        run_kokoro(text, args.voice, args.speed, args.out)
    else:
        run_chatterbox(text, args.ref_audio, args.out)

    if not os.path.exists(args.out) or os.path.getsize(args.out) < 1000:
        raise RuntimeError("Synthesis finished without a usable wav file")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        sys.exit(1)
