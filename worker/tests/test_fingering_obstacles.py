import base64
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from sheet_music_worker.fingering_obstacles import page_ink_artifact


def mask(artifact):
    width, height = artifact["mask_size"]
    return np.unpackbits(np.frombuffer(base64.b64decode(artifact["data"]), dtype=np.uint8))[:width * height].reshape(height, width)


def test_preserves_thin_slur_staff_digit_and_non_square_partial_cells(tmp_path: Path):
    image = Image.new("L", (4101, 101), 255)
    draw = ImageDraw.Draw(image)
    draw.line([(1, 10), (4099, 10)], fill=210, width=1)
    draw.arc((50, 20, 120, 70), 190, 330, fill=200, width=1)
    draw.text((130, 20), "12345", fill=0)
    draw.point((4100, 100), fill=0)
    path = tmp_path / "page.png"
    image.save(path)
    result = page_ink_artifact(path)
    ink = mask(result)
    assert result["source_pixels_per_cell"] == [3, 1]
    original = np.asarray(image) <= 220
    ys, xs = np.nonzero(original)
    assert ink[ys, xs // 3].all()
    assert ink[-1, -1] == 1
    assert not ink[80, 50:100].any()
    assert page_ink_artifact(path) == result


def test_transparency_is_composited_on_white(tmp_path: Path):
    image = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
    image.putpixel((5, 5), (0, 0, 0, 255))
    path = tmp_path / "transparent.png"
    image.save(path)
    assert mask(page_ink_artifact(path)).sum() == 1
