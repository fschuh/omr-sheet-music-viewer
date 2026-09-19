"""Render the integrated fixture with installed WebKitGTK on an isolated GTK display.

Start broadwayd on a private display, then set GDK_BACKEND=broadway and
BROADWAY_DISPLAY to that display. This is engine verification, not a touch-device test.
"""
import json
import argparse
from pathlib import Path
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, GLib, Gtk, WebKit2

root = Path(__file__).resolve().parents[1]
if not Gtk.init_check()[0]:
    raise SystemExit("No GTK test display: start broadwayd and set GDK_BACKEND/BROADWAY_DISPLAY")
parser = argparse.ArgumentParser()
parser.add_argument("--fixture", help="Prepared prototype fixture ID; defaults to integrated viewer controls")
parser.add_argument("--view", choices=["original", "annotated"], default="annotated")
args = parser.parse_args()
fixture_dir = root / "testdata/fingering-prototype" / (args.fixture or "")
Gtk.Settings.get_default().set_property("gtk-xft-dpi", 96 * 1024)
Gdk.Screen.get_default().set_resolution(96)
window = Gtk.Window()
window.set_default_size(1300, 1800)
if args.fixture:
    packet = json.loads((fixture_dir / "packet.js").read_text().removeprefix("window.fingeringFixture=").removesuffix(";"))
    width, height = packet["sidecar"]["source_image_size"]
    window.set_default_size(1300, round(1300 * height / width))
view = WebKit2.WebView.new_with_context(WebKit2.WebContext.new_ephemeral())
view.get_settings().set_allow_file_access_from_file_urls(True)
view.get_settings().set_allow_universal_access_from_file_urls(True)
window.add(view)
window.show_all()
failed = False
finished = False
attempts = 0


def fail(message):
    global failed
    failed = True
    print(message, file=sys.stderr, flush=True)
    Gtk.main_quit()


def snapshot_done(webview, result, _data):
    try:
        surface = webview.get_snapshot_finish(result)
        output = f"/tmp/fingering-webkit-{args.fixture or 'review'}-{args.view}.png"
        surface.write_to_png(output)
        print(f"WebKitGTK snapshot: {output}", flush=True)
        Gtk.main_quit()
    except Exception as error:
        fail(str(error))


def evaluated(webview, result, _data):
    global attempts, finished
    if finished:
        return
    try:
        value = json.loads(webview.evaluate_javascript_finish(result).to_string())
        if value.get("error"):
            fail(value["error"])
        elif value.get("count", 0) > 100 and (args.fixture or value.get("revisions", 0) > 0):
            finished = True
            if args.fixture:
                Path(f"/tmp/fingering-webkit-{args.fixture}-{args.view}.json").write_text(json.dumps(value))
                value = {"fixture": args.fixture, "view": args.view, "count": value["count"],
                         "milliseconds": value["report"]["milliseconds"]}
            print(json.dumps({"webkit": [WebKit2.get_major_version(), WebKit2.get_minor_version(), WebKit2.get_micro_version()], **value}), flush=True)
            GLib.timeout_add(1500, lambda: webview.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, snapshot_done, None))
        else:
            attempts += 1
            if attempts > 200:
                fail(f"WebKit fixture timeout: {value}")
    except Exception as error:
        fail(str(error))


def poll():
    if finished:
        return False
    script = """JSON.stringify({error: document.documentElement.dataset.error,
      count: Number(document.querySelector('#review-state')?.dataset.count) || 0,
      digits: document.querySelectorAll('[data-fingering-note]').length,
      workerPosts: window.fingeringLifecycle?.posted,
      revisions: Number(document.querySelector('#review-state')?.dataset.revisions) || 0,
      viewport: [innerWidth, innerHeight, devicePixelRatio],
      page: document.querySelector('.document-page')?.getBoundingClientRect().toJSON(),
      stage: document.querySelector('.viewer-stage')?.getBoundingClientRect().toJSON(),
      controls: document.querySelector('details')?.textContent,
      firstDigit: document.querySelector('[data-fingering-note]')?.outerHTML})"""
    if args.fixture:
        script = """JSON.stringify(document.documentElement.dataset.ready === 'true' ?
          {count: JSON.parse(document.querySelector('#metrics').textContent).placed,
           report: JSON.parse(document.querySelector('#metrics').textContent)} :
          {error: document.documentElement.dataset.ready === 'error' ? document.querySelector('#metrics').textContent : null})"""
    view.evaluate_javascript(script, -1, None, None, None, evaluated, None)
    return True


view.load_uri((fixture_dir / "review.html").as_uri() + f"?view={args.view}" if args.fixture else
              (root / "webapp/tools/fingering-controls-review.html").as_uri())
GLib.timeout_add(100, poll)
Gtk.main()
window.destroy()
sys.exit(1 if failed else 0)
