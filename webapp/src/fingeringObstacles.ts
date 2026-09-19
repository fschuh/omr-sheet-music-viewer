import type { InkObstacles, VisualBBox } from "./types";

export interface ObstacleMap {
  width: number;
  height: number;
  bytes: number;
  isClear(bounds: VisualBBox, clearance?: number): boolean;
}

/** Construct once in the annotation worker. The integral buffer remains private. */
export function createObstacleMap(artifact: InkObstacles): ObstacleMap {
  const [w, h] = artifact.mask_size;
  const [width, height] = artifact.source_image_size;
  const [sx, sy] = artifact.source_pixels_per_cell;
  if (artifact.version !== 1 || artifact.encoding !== "base64-bitset-msb" ||
      ![w, h, width, height, sx, sy].every(n => Number.isSafeInteger(n) && n > 0) ||
      w > 2048 || h > 2048 || Math.ceil(width / sx) !== w || Math.ceil(height / sy) !== h ||
      typeof artifact.data !== "string" || artifact.data.length > Math.ceil(w * h / 8 / 3) * 4 + 4) {
    throw new Error("Invalid page ink artifact");
  }
  const binary = atob(artifact.data);
  if (binary.length !== Math.ceil(w * h / 8)) throw new Error("Truncated page ink artifact");
  const stride = w + 1;
  const integral = new Uint32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const index = y * w + x;
      row += (binary.charCodeAt(index >>> 3) >>> (7 - (index & 7))) & 1;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }
  return Object.freeze({
    width, height, bytes: integral.byteLength,
    isClear(bounds: VisualBBox, clearance = 0): boolean {
      if (!bounds.every(Number.isFinite) || !Number.isFinite(clearance) || clearance < 0) return false;
      const [left, top, right, bottom] = bounds;
      if (left >= right || top >= bottom || left - clearance < 0 || top - clearance < 0 || right + clearance > width || bottom + clearance > height) return false;
      const x0 = Math.floor((left - clearance) / sx), y0 = Math.floor((top - clearance) / sy);
      const x1 = Math.ceil((right + clearance) / sx), y1 = Math.ceil((bottom + clearance) / sy);
      return integral[y1 * stride + x1] - integral[y0 * stride + x1]
        - integral[y1 * stride + x0] + integral[y0 * stride + x0] === 0;
    },
  });
}
