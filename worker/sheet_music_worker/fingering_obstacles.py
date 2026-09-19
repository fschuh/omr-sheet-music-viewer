"""Compact, conservative page ink. No staff removal, erosion or overlay pixels."""
from __future__ import annotations

import base64
import hashlib
import math
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

INK_VERSION = 1
LUMINANCE_THRESHOLD = 220
MAX_MASK_AXIS = 2048


def page_ink_artifact(path: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        if image.mode in ("RGBA", "LA") or "transparency" in image.info:
            rgba = image.convert("RGBA")
            background = Image.new("RGBA", image.size, "white")
            image = Image.alpha_composite(background, rgba)
        luminance = np.asarray(image.convert("L"))
    height, width = luminance.shape
    # Separate integer x/y cells retain every foreground source pixel, including
    # a partial cell at the right/bottom edge. Never interpolate before thresholding.
    cell_x = math.ceil(width / MAX_MASK_AXIS)
    cell_y = math.ceil(height / MAX_MASK_AXIS)
    mask_width, mask_height = math.ceil(width / cell_x), math.ceil(height / cell_y)
    ink = luminance <= LUMINANCE_THRESHOLD
    padded = np.pad(ink, ((0, mask_height * cell_y - height), (0, mask_width * cell_x - width)))
    mask = padded.reshape(mask_height, cell_y, mask_width, cell_x).any(axis=(1, 3))
    packed = np.packbits(mask.reshape(-1), bitorder="big")
    return {
        "version": INK_VERSION, "encoding": "base64-bitset-msb",
        "source_image_size": [width, height], "mask_size": [mask_width, mask_height],
        "source_pixels_per_cell": [cell_x, cell_y],
        "raster_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "threshold": LUMINANCE_THRESHOLD,
        "data": base64.b64encode(packed.tobytes()).decode("ascii"),
    }
