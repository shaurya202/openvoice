"""Optional Python TTS worker for Kokoro and Chatterbox.

Usage:
  python worker/tts_worker.py --engine kokoro --text "Hello" --voice af_heart --out out.wav
  python worker/tts_worker.py --engine chatterbox --text "Hello" --out out.wav [--ref-audio ref.wav]
"""
import argparse
import sys


def run_kokoro(text: str, voice: str, speed: float, out_path: str) -> None:
    try:
        from kokoro import KPipeline  # type: ignore
        import soundfile as sf  # type: ignore
        import numpy as np  # type: ignore
    except ImportError as exc:
        print(f"kokoro not installed: {exc}", file=sys.stderr)
        sys.exit(2)

    lang_code = voice[0] if voice else "a"
    pipeline = KPipeline(lang_code=lang_code)
    chunks = [audio for _, _, audio in pipeline(text, voice=voice, speed=speed)]
    if not chunks:
        raise RuntimeError("Kokoro produced no audio chunks")
    audio = np.concatenate(chunks)
    sf.write(out_path, audio, 24000, subtype="PCM_16")


def run_chatterbox(text: str, ref_audio: str | None, out_path: str) -> None:
    try:
        import torchaudio  # type: ignore
        from chatterbox.tts import ChatterboxTTS  # type: ignore
    except ImportError as exc:
        print(f"chatterbox-tts not installed: {exc}", file=sys.stderr)
        sys.exit(2)

    model = ChatterboxTTS.from_pretrained(device="cpu")
    wav = model.generate(text, audio_prompt_path=ref_audio) if ref_audio else model.generate(text)
    torchaudio.save(out_path, wav, model.sr, encoding="PCM_S", bits_per_sample=16)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["kokoro", "chatterbox"], required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--ref-audio", default=None)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    if args.engine == "kokoro":
        run_kokoro(args.text, args.voice, args.speed, args.out)
    else:
        run_chatterbox(args.text, args.ref_audio, args.out)


if __name__ == "__main__":
    main()
