# Third-party notices

## HOMR

This repository includes a modified fork of
[HOMR](https://github.com/liebharc/homr), an end-to-end optical music
recognition system originally created by Christian Liebhardt and developed by
its contributors.

The bundled source is located in `vendor/homr` and was imported from
[fschuh/homr](https://github.com/fschuh/homr) at commit
`a4988983b6464ec420a200755d1bc9468c7d31cd` (2026-07-21). The fork has been
modified by Fred Schuh and contributors. Its changes include the visual-sidecar
export and subsequent recognition, geometry, note-matching, and playback-overlay
improvements used by this application. The fork's Git history contains the
detailed modification record. The vendored `pyproject.toml` additionally uses a
static local version derived from that commit so its package identity remains
stable outside the fork's original Git repository.

HOMR is licensed under the GNU Affero General Public License version 3. The
license text and upstream notices are preserved in `vendor/homr/LICENSE` and
`vendor/homr`.
