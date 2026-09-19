"""Measure immutable mask production on development fixtures, without editing them."""
import json
from pathlib import Path
import platform
import resource
import time

from sheet_music_worker.fingering_obstacles import page_ink_artifact

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "plans/fingering-fixtures.json").read_text())
results = []
for fixture in manifest["fixtures"]:
    if fixture["split"] != "development":
        continue
    path = root.parent / fixture["image"]["path"]
    start = time.perf_counter()
    artifact = page_ink_artifact(path)
    milliseconds = (time.perf_counter() - start) * 1000
    w, h = artifact["mask_size"]
    results.append({"id": fixture["id"], "milliseconds": round(milliseconds, 2),
                    "artifact_bytes": len(json.dumps(artifact)), "integral_bytes": (w + 1) * (h + 1) * 4})
cpu = next((line.split(":", 1)[1].strip() for line in Path("/proc/cpuinfo").read_text().splitlines()
            if line.startswith("model name")), platform.processor())
print(json.dumps({"platform": platform.platform(), "cpu": cpu,
                  "peak_process_rss_kib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                  "threshold": 220, "results": results}, indent=2))
