import { findPianoKeyElements, FIRST_PIANO_MIDI } from "../PianoKeyboard";

const KEY_COUNT = 88;
/** Opacity of a key's highlight as its note enters the highway, and just before it is due. */
const FAINTEST_APPROACH = 0.06;
const STRONGEST_APPROACH = 0.7;

/**
 * Eased so the highlight stays faint while the note is far away and gathers
 * quickly over its last stretch. Quantized to whole percent so a key's style is
 * written only when the change is visible.
 */
export function approachOpacity(progress: number): number {
  if (progress <= 0) return 0;
  const opacity = FAINTEST_APPROACH + (STRONGEST_APPROACH - FAINTEST_APPROACH) * progress * progress;
  return Math.round(opacity * 100) / 100;
}

/**
 * Writes each key's --approach custom property directly, so the keyboard does
 * not re-render every frame; only keys whose value changed are touched.
 */
export class KeyApproachPainter {
  private keys = new Map<number, HTMLElement>();
  private readonly painted = new Float32Array(KEY_COUNT).fill(-1);

  constructor(private readonly root: ParentNode) {}

  paint(progress: Float32Array): void {
    this.refreshKeys();
    for (let key = 0; key < KEY_COUNT; key += 1) {
      const opacity = approachOpacity(progress[key]);
      if (opacity === this.painted[key]) continue;
      this.painted[key] = opacity;
      this.keys.get(key + FIRST_PIANO_MIDI)?.style.setProperty("--approach", String(opacity));
    }
  }

  clear(): void {
    for (const element of this.keys.values()) element.style.removeProperty("--approach");
    this.keys.clear();
    this.painted.fill(-1);
  }

  /** The keyboard can mount after the highway, or remount; re-find its keys then. */
  private refreshKeys(): void {
    const first = this.keys.values().next().value;
    if (this.keys.size === KEY_COUNT && first?.isConnected) return;
    this.keys = findPianoKeyElements(this.root);
    this.painted.fill(-1);
  }
}
