/** Where a note or chord stands: its page, its system there, and how far across the page. */
export interface SystemSpot {
  pageIndex: number;
  staffGroupIndex: number;
  x: number;
}

function compareSystems(a: SystemSpot, b: SystemSpot): number {
  return a.pageIndex - b.pageIndex || a.staffGroupIndex - b.staffGroupIndex;
}

/**
 * What a step down (1) or up (-1) a system from `from` lands on: of the items in the next or
 * previous system in page order, which may be on another page, the index of the one standing
 * nearest across from it. Equally near items go by `rank`, lowest first, then by order.
 * -1 when there is no system that way.
 */
export function acrossSystem<T>(
  items: readonly T[],
  spot: (item: T) => SystemSpot,
  from: SystemSpot,
  direction: 1 | -1,
  rank: (item: T) => number = () => 0,
): number {
  let system: SystemSpot | null = null;
  for (const item of items) {
    const candidate = spot(item);
    if (compareSystems(candidate, from) * direction <= 0) continue;
    if (!system || compareSystems(candidate, system) * direction < 0) system = candidate;
  }
  if (!system) return -1;
  let best = -1;
  let bestDistance = Infinity;
  let bestRank = Infinity;
  items.forEach((item, index) => {
    const candidate = spot(item);
    if (compareSystems(candidate, system!) !== 0) return;
    const distance = Math.abs(candidate.x - from.x);
    const itemRank = rank(item);
    // Within a hair counts as level, so that rank decides between a chord's notes.
    if (distance < bestDistance - 1e-6 || (Math.abs(distance - bestDistance) <= 1e-6 && itemRank < bestRank)) {
      best = index;
      bestDistance = distance;
      bestRank = itemRank;
    }
  });
  return best;
}
