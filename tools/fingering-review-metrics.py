"""Report coverage AND rendered-pixel overlap independently of the layout mask."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "plans/fingering-fixtures.json").read_text())
rows = []
for fixture in manifest["fixtures"]:
    directory = root / "testdata/fingering-prototype" / fixture["id"]
    metrics = directory / "metrics-1300.json"
    if not metrics.exists():
        failure = directory / "failure.json"
        rows.append({"id": fixture["id"], "split": fixture["split"],
                     "baseline_pitched_values": len(fixture["fixed_layout_values"]),
                     "unavailable": json.loads(failure.read_text())["error"] if failure.exists() else "not prepared"})
        continue
    result = json.loads(metrics.read_text())
    result.pop("bounds")
    result.pop("metrics")
    original = np.asarray(Image.open(directory / "original-1300.png").convert("RGB"), dtype=np.int16)
    annotated = np.asarray(Image.open(directory / "annotated-1300.png").convert("RGB"), dtype=np.int16)
    blue = (annotated[:, :, 2] > annotated[:, :, 0] + 30) & (annotated[:, :, 2] > annotated[:, :, 1] + 10)
    dark = original.mean(axis=2) < 180
    result["blue_over_original_dark_pixels"] = int(np.count_nonzero(blue & dark))
    result["split"] = fixture["split"]
    result["end_to_end_percent"] = round(100 * result["placed"] / result["counts"]["predicted"], 2)
    result["placement_percent"] = round(100 * result["placed"] / result["counts"]["supported"], 2)
    result["packet_sha256"] = hashlib.sha256((directory / "packet.js").read_bytes()).hexdigest()
    rows.append(result)
print(json.dumps({"layout": "staff-lanes-v2", "font": "Arial, sans-serif", "review_width": 1300,
                  "values": "Frozen synthetic cyclic digits from each regenerated matched MusicXML; not fingering-quality predictions",
                  "manual_exclusions": 0, "pages": rows,
                  "additional_unavailable_references": manifest["unavailable_references"]}, indent=2))
