"""Transcribe a consent recording with faster-whisper.

Prints a single line: OPENVOICE_TRANSCRIPT:<text>
Exit code 2 means the speech-to-text package is not installed.
"""
import argparse
import os
import sys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        print(f"audio file not found: {args.audio}", file=sys.stderr)
        sys.exit(2)

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        print(
            "faster-whisper is not installed. Run scripts/setup-python.sh "
            f"(or pip install faster-whisper). {exc}",
            file=sys.stderr,
        )
        sys.exit(2)

    model_name = os.environ.get("OPENVOICE_WHISPER_MODEL", "base.en")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(
        args.audio,
        language="en",
        vad_filter=True,
        beam_size=5,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    sys.stdout.write(f"OPENVOICE_TRANSCRIPT:{text}\n")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
