# Annotation geometry compatibility

The producer uses optional `annotation_geometry.version = 1` on sidecar v3.
See HOMR's visual-sidecar contract for sampled lines and physical/system indices.
The worker validates advertised geometry and scales x and y separately when
promoting its private inference raster to the displayed page. The browser checks
the capability before annotation layout. Missing or unusable geometry means
annotation unavailable, while ordinary v3 viewing and keyboard fingerings remain
supported. Existing page retry is the targeted regeneration mechanism.

Annotation cache identity must include `physical-staff-curves-v1`, raster identity
and geometry content. Do not use the normal v3 recognition-cache validity bit as
an overlay-ready bit. There is intentionally no blanket recognition-cache bump.

Worker dependency and lock pin HOMR commit
`a750ab029cd035474f6e4a2f82b4815f3d8d0c54`. Publish that commit before distributing
a worker that installs from GitHub. For this two-repository development checkout,
use `PYTHONPATH=../homr:worker .venv/bin/python ...` from the viewer repository.
No remote push or release is performed by this implementation.

Validation so far: 134 HOMR sidecar/evaluator tests; 25 worker tests; browser
capability/interpolation tests and production build. These validate coordinate
transforms and backward compatibility, not real-page visual alignment. Regenerated
fixture review remains required by the experiment gate.
