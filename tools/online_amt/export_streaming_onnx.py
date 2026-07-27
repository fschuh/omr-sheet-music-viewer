from __future__ import annotations

import argparse
import sys
from pathlib import Path

import torch

from streaming_step import INPUT_NAMES, OUTPUT_NAMES, OnlineAmtStreamingStep


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export online_amt as one stateful 512-sample ONNX step.",
    )
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def build_streaming_step(
    source_root: Path,
    checkpoint: Path,
) -> OnlineAmtStreamingStep:
    source_root = source_root.resolve()
    if str(source_root) not in sys.path:
        sys.path.insert(0, str(source_root))
    from transcribe import OnlineTranscriber, load_model

    model = load_model(checkpoint.resolve())
    reference = OnlineTranscriber(model, return_roll=False)
    initial_state = (
        reference.audio_buffer,
        reference.mel_buffer,
        reference.acoustic_layer_outputs[0],
        reference.acoustic_layer_outputs[1],
        reference.hidden[0],
        reference.hidden[1],
        reference.prev_output,
        torch.zeros((1,), dtype=torch.int64, device=reference.device),
    )
    return OnlineAmtStreamingStep(model, initial_state).eval()


def main() -> None:
    args = parse_args()
    step = build_streaming_step(args.source_root, args.checkpoint)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    example_inputs = step.initial_inputs()
    with torch.inference_mode():
        torch.onnx.export(
            step,
            example_inputs,
            args.output,
            input_names=list(INPUT_NAMES),
            output_names=list(OUTPUT_NAMES),
            opset_version=18,
            dynamo=True,
            external_data=False,
            optimize=True,
            verify=True,
        )
    print(f"Exported {args.output} ({args.output.stat().st_size / 1_000_000:.1f} MB)")


if __name__ == "__main__":
    main()
