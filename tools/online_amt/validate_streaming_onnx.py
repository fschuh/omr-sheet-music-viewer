from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

from export_streaming_onnx import build_streaming_step
from streaming_step import INPUT_NAMES, OUTPUT_NAMES


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate and benchmark PyTorch and native ONNX streaming.",
    )
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--onnx", type=Path, required=True)
    parser.add_argument("--frames", type=int, default=180)
    parser.add_argument("--browser-fixture-dir", type=Path)
    return parser.parse_args()


def fixture_audio(frames: int) -> np.ndarray:
    sample_rate = 16_000
    chunk_size = 512
    result = np.zeros((frames, chunk_size), dtype=np.float32)
    for frame_index in range(frames):
        if frame_index < 12 or frame_index >= frames - 24:
            continue
        sample_offset = (frame_index - 12) * chunk_size
        sample_indices = np.arange(chunk_size, dtype=np.float64) + sample_offset
        time_seconds = sample_indices / sample_rate
        envelope = np.exp(-1.6 * time_seconds)
        attack = np.minimum(1.0, sample_indices / (0.012 * sample_rate))
        harmonics = np.zeros(chunk_size, dtype=np.float64)
        for harmonic in range(1, 8):
            harmonics += (
                np.sin(2 * np.pi * 440.0 * harmonic * time_seconds) / harmonic
            )
        result[frame_index] = (
            0.5 * attack * envelope * harmonics
        ).astype(np.float32)
    return result


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, math.ceil(fraction * len(ordered)) - 1)
    return ordered[max(0, index)]


def latency_summary(values: list[float]) -> dict[str, float]:
    return {
        "meanMs": statistics.fmean(values),
        "p50Ms": percentile(values, 0.50),
        "p95Ms": percentile(values, 0.95),
        "p99Ms": percentile(values, 0.99),
        "maxMs": max(values),
    }


def torch_run(
    step: torch.nn.Module,
    chunks: np.ndarray,
) -> tuple[list[np.ndarray], list[float]]:
    state = step.initial_inputs(torch.from_numpy(chunks[0]))
    outputs_by_frame: list[np.ndarray] = []
    durations: list[float] = []
    with torch.inference_mode():
        for frame_index, chunk in enumerate(chunks):
            if frame_index:
                state = (
                    torch.from_numpy(chunk).reshape(1, -1),
                    torch.zeros((1,), dtype=torch.bool),
                    *output[2:],
                )
            started = time.perf_counter()
            output = step(*state)
            durations.append((time.perf_counter() - started) * 1_000)
            outputs_by_frame.append(output[0].detach().cpu().numpy())
    return outputs_by_frame, durations


def onnx_run(
    session: ort.InferenceSession,
    step: torch.nn.Module,
    chunks: np.ndarray,
) -> tuple[list[list[np.ndarray]], list[float]]:
    initial = step.initial_inputs(torch.from_numpy(chunks[0]))
    feeds = {
        name: tensor.detach().cpu().numpy()
        for name, tensor in zip(INPUT_NAMES, initial, strict=True)
    }
    outputs_by_frame: list[list[np.ndarray]] = []
    durations: list[float] = []
    for frame_index, chunk in enumerate(chunks):
        if frame_index:
            feeds = {
                "audio_chunk": chunk.reshape(1, -1),
                "reset": np.zeros((1,), dtype=np.bool_),
                **{
                    INPUT_NAMES[index]: outputs[index]
                    for index in range(2, len(INPUT_NAMES))
                },
            }
        started = time.perf_counter()
        outputs = session.run(list(OUTPUT_NAMES), feeds)
        durations.append((time.perf_counter() - started) * 1_000)
        outputs_by_frame.append(outputs)
    return outputs_by_frame, durations


def write_browser_fixture(
    directory: Path,
    chunks: np.ndarray,
    onnx_outputs: list[list[np.ndarray]],
) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    chunks.astype("<f4").tofile(directory / "audio.f32")
    np.concatenate(
        [outputs[0].reshape(1, 88, 5) for outputs in onnx_outputs],
        axis=0,
    ).astype("<f4").tofile(directory / "scores.f32")
    np.concatenate(
        [outputs[1].reshape(1) for outputs in onnx_outputs],
    ).astype(np.uint8).tofile(directory / "signal-active.u8")
    np.concatenate(
        [outputs[8].reshape(1, 88) for outputs in onnx_outputs],
        axis=0,
    ).astype(np.uint8).tofile(directory / "states.u8")
    (directory / "metadata.json").write_text(
        json.dumps(
            {
                "frames": int(chunks.shape[0]),
                "chunkSize": int(chunks.shape[1]),
                "pitches": 88,
                "states": 5,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def compare_reference_decoder(
    source_root: Path,
    checkpoint: Path,
    step: torch.nn.Module,
    chunks: np.ndarray,
) -> dict[str, int]:
    source_root = source_root.resolve()
    if str(source_root) not in sys.path:
        sys.path.insert(0, str(source_root))
    from transcribe import OnlineTranscriber, load_model

    reference = OnlineTranscriber(
        load_model(checkpoint.resolve()),
        return_roll=False,
    )
    state = step.initial_inputs(torch.from_numpy(chunks[0]))
    state_mismatches = 0
    signal_active_mismatches = 0
    silence_count_mismatches = 0
    with torch.inference_mode():
        for frame_index, chunk in enumerate(chunks):
            if frame_index:
                state = (
                    torch.from_numpy(chunk).reshape(1, -1),
                    torch.zeros((1,), dtype=torch.bool),
                    *step_outputs[2:],
                )
            reference.inference(chunk)
            step_outputs = step(*state)
            state_mismatches += int(
                np.count_nonzero(
                    reference.prev_output.cpu().numpy()
                    != step_outputs[8].cpu().numpy()
                )
            )
            signal_active_mismatches += int(
                reference.signal_active != bool(step_outputs[1].item())
            )
            silence_count_mismatches += int(
                reference.num_under_thr != int(step_outputs[9].item())
            )
    return {
        "stateMismatches": state_mismatches,
        "signalActiveMismatches": signal_active_mismatches,
        "silenceCountMismatches": silence_count_mismatches,
    }


def main() -> None:
    args = parse_args()
    torch.set_num_threads(1)
    step = build_streaming_step(args.source_root, args.checkpoint)
    chunks = fixture_audio(args.frames)
    session = ort.InferenceSession(
        str(args.onnx.resolve()),
        sess_options=ort.SessionOptions(),
        providers=["CPUExecutionProvider"],
    )

    torch_outputs, torch_durations = torch_run(step, chunks)
    onnx_outputs, onnx_durations = onnx_run(session, step, chunks)

    max_score_error = 0.0
    state_mismatches = 0
    active_mismatches = 0
    for torch_scores, runtime_outputs in zip(
        torch_outputs,
        onnx_outputs,
        strict=True,
    ):
        max_score_error = max(
            max_score_error,
            float(np.max(np.abs(torch_scores - runtime_outputs[0]))),
        )
        torch_states = np.argmax(torch_scores, axis=3)
        state_mismatches += int(np.count_nonzero(torch_states != runtime_outputs[8]))
    # Compare active flags through a second lightweight PyTorch pass so all
    # recurrent state remains independent from the native ONNX pass.
    torch_state = step.initial_inputs(torch.from_numpy(chunks[0]))
    with torch.inference_mode():
        for frame_index, (chunk, runtime_outputs) in enumerate(
            zip(chunks, onnx_outputs, strict=True),
        ):
            if frame_index:
                torch_state = (
                    torch.from_numpy(chunk).reshape(1, -1),
                    torch.zeros((1,), dtype=torch.bool),
                    *torch_result[2:],
                )
            torch_result = step(*torch_state)
            active_mismatches += int(
                bool(torch_result[1].item()) != bool(runtime_outputs[1].item())
            )

    warmup = min(20, max(0, args.frames // 5))
    report = {
        "frames": args.frames,
        "referenceDecoderParity": compare_reference_decoder(
            args.source_root,
            args.checkpoint,
            step,
            chunks,
        ),
        "parity": {
            "maxAbsoluteScoreError": max_score_error,
            "stateMismatches": state_mismatches,
            "signalActiveMismatches": active_mismatches,
        },
        "pytorchOneThread": latency_summary(torch_durations[warmup:]),
        "onnxRuntimeNativeCpu": latency_summary(onnx_durations[warmup:]),
    }
    print(json.dumps(report, indent=2))
    if (
        any(report["referenceDecoderParity"].values())
        or state_mismatches
        or active_mismatches
        or max_score_error > 2e-4
    ):
        raise SystemExit("ONNX parity check failed")
    if args.browser_fixture_dir:
        write_browser_fixture(args.browser_fixture_dir, chunks, onnx_outputs)


if __name__ == "__main__":
    main()
