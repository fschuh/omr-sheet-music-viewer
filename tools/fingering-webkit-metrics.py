"""Compare the held-out WebKit snapshots independently from occupancy masks."""
import json
from pathlib import Path

import numpy as np
from PIL import Image

rows = []
for annotated_path in sorted(Path("/tmp").glob("fingering-webkit-*-annotated.json")):
    prefix = str(annotated_path).removesuffix("-annotated.json")
    annotated = json.loads(annotated_path.read_text())["report"]
    original = json.loads(Path(prefix + "-original.json").read_text())["report"]
    assert annotated["bounds"] == original["bounds"], "Positions changed across loads"
    a = np.asarray(Image.open(prefix + "-annotated.png").convert("RGB"), dtype=np.int16)
    o = np.asarray(Image.open(prefix + "-original.png").convert("RGB"), dtype=np.int16)
    blue = (a[:, :, 2] > a[:, :, 0] + 30) & (a[:, :, 2] > a[:, :, 1] + 10)
    overlap = int(np.count_nonzero(blue & (o.mean(axis=2) < 180)))
    rows.append({"id": annotated["id"], "placed": annotated["placed"], "counts": annotated["counts"],
                 "milliseconds": annotated["milliseconds"], "dark_pixel_overlap": overlap})
print(json.dumps({"engine": "WebKitGTK 2.52.6", "pages": rows}, indent=2))
