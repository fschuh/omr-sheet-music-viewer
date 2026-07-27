from __future__ import annotations

from collections.abc import Sequence

import torch
from torch import nn


CHUNK_SIZE = 512
SILENCE_PATIENCE_FRAMES = 100
SILENCE_THRESHOLD = 0.001

INPUT_NAMES = (
    "audio_chunk",
    "reset",
    "audio_buffer",
    "mel_buffer",
    "cnn_cache_1",
    "cnn_cache_2",
    "lstm_h",
    "lstm_c",
    "previous_output",
    "silence_count",
)

OUTPUT_NAMES = (
    "scores",
    "signal_active",
    "audio_buffer_out",
    "mel_buffer_out",
    "cnn_cache_1_out",
    "cnn_cache_2_out",
    "lstm_h_out",
    "lstm_c_out",
    "previous_output_out",
    "silence_count_out",
)


def _select(reset: torch.Tensor, initial: torch.Tensor, current: torch.Tensor) -> torch.Tensor:
    shape = (reset.shape[0],) + (1,) * (current.ndim - 1)
    return torch.where(reset.reshape(shape), initial, current)


def _select_active(
    signal_active: torch.Tensor,
    candidate: torch.Tensor,
    current: torch.Tensor,
) -> torch.Tensor:
    shape = (signal_active.shape[0],) + (1,) * (current.ndim - 1)
    return torch.where(signal_active.reshape(shape), candidate, current)


class OnlineAmtStreamingStep(nn.Module):
    """Pure, fixed-shape version of one ``OnlineTranscriber.inference`` step.

    All state is explicit so ONNX Runtime can own the streaming loop without
    reproducing the mel, CNN cache, or LSTM implementation in TypeScript.
    """

    def __init__(self, model: nn.Module, initial_state: Sequence[torch.Tensor]):
        super().__init__()
        if len(initial_state) != 8:
            raise ValueError("Expected eight state tensors")
        self.model = model.eval()
        (
            initial_audio,
            initial_mel,
            initial_cache_1,
            initial_cache_2,
            initial_h,
            initial_c,
            initial_previous,
            initial_silence_count,
        ) = initial_state
        self.register_buffer("initial_audio", initial_audio.detach().clone())
        self.register_buffer("initial_mel", initial_mel.detach().clone())
        self.register_buffer("initial_cache_1", initial_cache_1.detach().clone())
        self.register_buffer("initial_cache_2", initial_cache_2.detach().clone())
        self.register_buffer("initial_h", initial_h.detach().clone())
        self.register_buffer("initial_c", initial_c.detach().clone())
        self.register_buffer("initial_previous", initial_previous.detach().clone())
        self.register_buffer(
            "initial_silence_count",
            initial_silence_count.detach().clone(),
        )
        self.register_buffer(
            "onset_weight",
            torch.tensor([1.0, 1.0, 1.0, 2.0, 2.0], dtype=torch.float32)
            .reshape(1, 1, 1, 5),
        )

    def initial_inputs(
        self,
        audio_chunk: torch.Tensor | None = None,
    ) -> tuple[torch.Tensor, ...]:
        device = self.initial_audio.device
        chunk = (
            torch.zeros((1, CHUNK_SIZE), dtype=torch.float32, device=device)
            if audio_chunk is None
            else audio_chunk.to(device=device, dtype=torch.float32).reshape(1, CHUNK_SIZE)
        )
        return (
            chunk,
            torch.ones((1,), dtype=torch.bool, device=device),
            torch.zeros_like(self.initial_audio),
            torch.zeros_like(self.initial_mel),
            torch.zeros_like(self.initial_cache_1),
            torch.zeros_like(self.initial_cache_2),
            torch.zeros_like(self.initial_h),
            torch.zeros_like(self.initial_c),
            torch.zeros_like(self.initial_previous),
            torch.zeros_like(self.initial_silence_count),
        )

    def forward(
        self,
        audio_chunk: torch.Tensor,
        reset: torch.Tensor,
        audio_buffer: torch.Tensor,
        mel_buffer: torch.Tensor,
        cnn_cache_1: torch.Tensor,
        cnn_cache_2: torch.Tensor,
        lstm_h: torch.Tensor,
        lstm_c: torch.Tensor,
        previous_output: torch.Tensor,
        silence_count: torch.Tensor,
    ) -> tuple[torch.Tensor, ...]:
        audio_buffer = _select(reset, self.initial_audio, audio_buffer)
        mel_buffer = _select(reset, self.initial_mel, mel_buffer)
        cnn_cache_1 = _select(reset, self.initial_cache_1, cnn_cache_1)
        cnn_cache_2 = _select(reset, self.initial_cache_2, cnn_cache_2)
        lstm_h = _select(reset, self.initial_h, lstm_h)
        lstm_c = _select(reset, self.initial_c, lstm_c)
        previous_output = _select(reset, self.initial_previous, previous_output)
        silence_count = _select(
            reset,
            self.initial_silence_count,
            silence_count,
        )

        audio_buffer_out = torch.cat(
            (audio_buffer[:, CHUNK_SIZE:], audio_chunk),
            dim=1,
        )
        pseudo_intensity = (
            torch.amax(audio_buffer_out, dim=1)
            - torch.amin(audio_buffer_out, dim=1)
        )
        under_threshold = pseudo_intensity < SILENCE_THRESHOLD
        silence_count_out = torch.where(
            under_threshold,
            silence_count + 1,
            torch.zeros_like(silence_count),
        )
        signal_active = silence_count_out <= SILENCE_PATIENCE_FRAMES

        # Call the registered tensor operations directly. MelSpectrogram.forward
        # also contains a Python ``if torch.any(...)`` input assertion, which is
        # useful at the public API boundary but cannot be represented in ONNX.
        magnitudes = self.model.melspectrogram.stft(audio_buffer_out[:, -2048:])
        newest_mel = torch.matmul(
            self.model.melspectrogram.mel_basis,
            magnitudes,
        )
        newest_mel = torch.log(torch.clamp(newest_mel, min=1e-5))
        mel_candidate = torch.cat((mel_buffer[:, :, 1:], newest_mel), dim=2)

        layers = self.model.acoustic_model.cnn
        x = mel_candidate.transpose(-1, -2)[:, -3:, :].unsqueeze(1)
        for index in range(3):
            x = layers[index](x)
        cache_1_candidate = torch.cat((cnn_cache_1[:, :, 1:, :], x), dim=2)

        x = cache_1_candidate[:, :, -3:, :]
        for index in range(3, 8):
            x = layers[index](x)
        cache_2_candidate = torch.cat((cnn_cache_2[:, :, 1:, :], x), dim=2)

        x = cache_2_candidate
        for index in range(8, 13):
            x = layers[index](x)
        x = x.transpose(1, 2).flatten(-2)
        acoustic_out = self.model.acoustic_model.fc(x)

        previous_embedding = self.model.class_embedding(previous_output).reshape(
            acoustic_out.shape[0],
            1,
            self.model.output_features * 2,
        )
        language_input = torch.cat((acoustic_out, previous_embedding), dim=2)
        language_out, (h_candidate, c_candidate) = self.model.language_model(
            language_input,
            (lstm_h, lstm_c),
        )
        logits = self.model.language_post(language_out).reshape(
            acoustic_out.shape[0],
            1,
            self.model.output_features,
            5,
        )
        scores_candidate = torch.softmax(logits, dim=3) * self.onset_weight
        previous_candidate = torch.argmax(scores_candidate, dim=3)

        mel_buffer_out = _select_active(signal_active, mel_candidate, mel_buffer)
        cnn_cache_1_out = _select_active(
            signal_active,
            cache_1_candidate,
            cnn_cache_1,
        )
        cnn_cache_2_out = _select_active(
            signal_active,
            cache_2_candidate,
            cnn_cache_2,
        )
        lstm_h_out = _select_active(signal_active, h_candidate, lstm_h)
        lstm_c_out = _select_active(signal_active, c_candidate, lstm_c)
        previous_output_out = _select_active(
            signal_active,
            previous_candidate,
            previous_output,
        )
        scores = _select_active(
            signal_active,
            scores_candidate,
            torch.zeros_like(scores_candidate),
        )

        return (
            scores,
            signal_active,
            audio_buffer_out,
            mel_buffer_out,
            cnn_cache_1_out,
            cnn_cache_2_out,
            lstm_h_out,
            lstm_c_out,
            previous_output_out,
            silence_count_out,
        )


def next_inputs(
    audio_chunk: torch.Tensor,
    outputs: Sequence[torch.Tensor],
) -> tuple[torch.Tensor, ...]:
    """Build the next call's inputs from a streaming step's outputs."""
    return (
        audio_chunk,
        torch.zeros((1,), dtype=torch.bool, device=audio_chunk.device),
        *outputs[2:],
    )
