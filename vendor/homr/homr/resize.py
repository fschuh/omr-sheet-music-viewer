from dataclasses import dataclass

import numpy as np
from PIL import Image

from homr.type_definitions import NDArray


@dataclass(frozen=True)
class ResizeResult:
    image: NDArray
    original_size: tuple[int, int]
    resized_size: tuple[int, int]
    scale_x: float
    scale_y: float


def calc_target_image_size(width: int, height: int) -> tuple[int, int]:
    """
    Target a fixed width while preserving aspect ratio.
    """
    target_width = 1920

    if width == target_width:
        return width, height

    ratio = target_width / width
    tar_w = target_width
    tar_h = round(height * ratio)

    return tar_w, tar_h


def resize_image(image_arr: NDArray) -> NDArray:
    return resize_image_with_metadata(image_arr).image


def resize_image_with_metadata(image_arr: NDArray) -> ResizeResult:
    image = Image.fromarray(image_arr)
    original_size = (image.size[0], image.size[1])
    tar_w, tar_h = calc_target_image_size(image.size[0], image.size[1])
    if tar_w == image_arr.shape[1] and tar_h == image_arr.shape[0]:
        resized = image_arr
    else:
        resized = np.array(image.resize((tar_w, tar_h)))
    return ResizeResult(
        image=resized,
        original_size=original_size,
        resized_size=(tar_w, tar_h),
        scale_x=tar_w / original_size[0],
        scale_y=tar_h / original_size[1],
    )
