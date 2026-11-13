import { findPianoKeyElements, FIRST_PIANO_MIDI } from "../PianoKeyboard";

const KEY_COUNT = 88;

/**
 * Quantized to whole percent, so a key's style is written only when the change
 * is visible. 0 means no note on the way.
 */
export function approachLevel(progress: number): number {
  return progress > 0 ? Math.max(0.01, Math.round(progress * 100) / 100) : 0;
}

/**
 * Writes each key's --approach custom property (how close its next note is, 0
 * to 1) and data-approach attribute (that note's hand) directly, so the keyboard
 * does not re-render every frame; only keys whose value changed are touched. The
 * keyboard's upcoming-key effect decides what the two look like.
 */
export class KeyApproachPainter {
  private keys = new Map<number, HTMLElement>();
  private keysElement: Element | null = null;
  private keysRange: string | null = null;
  private readonly painted = new Float32Array(KEY_COUNT).fill(-1);
  private readonly paintedHands = new Uint8Array(KEY_COUNT);

  constructor(private readonly root: ParentNode) {}

  paint(progress: Float32Array, hands: Uint8Array): void {
    this.refreshKeys();
    for (let key = 0; key < KEY_COUNT; key += 1) {
      const level = approachLevel(progress[key]);
      const hand = level > 0 ? hands[key] : 0;
      if (level === this.painted[key] && hand === this.paintedHands[key]) continue;
      this.painted[key] = level;
      this.paintedHands[key] = hand;
      const element = this.keys.get(key + FIRST_PIANO_MIDI);
      if (!element) continue;
      element.style.setProperty("--approach", String(level));
      if (level > 0) element.dataset.approach = hand === 2 ? "left" : "right";
      else delete element.dataset.approach;
    }
  }

  clear(): void {
    for (const element of this.keys.values()) {
      element.style.removeProperty("--approach");
      delete element.dataset.approach;
    }
    this.keys.clear();
    this.keysElement = null;
    this.painted.fill(-1);
    this.paintedHands.fill(0);
  }

  /**
   * The keyboard can mount after the highway, remount, or change the keys it
   * shows; re-find its keys then.
   */
  private refreshKeys(): void {
    const keysElement = this.root.querySelector(".piano-keys");
    const range = keysElement?.getAttribute("data-range") ?? null;
    if (keysElement === this.keysElement && range === this.keysRange) return;
    this.keysElement = keysElement;
    this.keysRange = range;
    this.keys = findPianoKeyElements(this.root);
    this.painted.fill(-1);
    this.paintedHands.fill(0);
  }
}
