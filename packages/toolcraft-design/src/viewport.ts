/** Select wrapped rows from the tail, retaining only one viewport of rows. */
export function selectViewportTail<T, R>(items: readonly T[], height: number, offset: number, renderRows: (item: T) => readonly R[]): { rows: R[]; offset: number } {
  height = Math.max(0, Math.floor(height));
  offset = Math.max(0, Math.floor(offset));
  if (!height) return { rows: [], offset: 0 };
  const selected: R[] = [];
  const oldest: R[] = [];
  let visited = 0;
  for (let index = items.length - 1; index >= 0; index--) {
    const rows = renderRows(items[index]!);
    for (let row = rows.length - 1; row >= 0; row--) {
      const value = rows[row]!;
      oldest.push(value);
      if (oldest.length > height) oldest.shift();
      if (visited >= offset && selected.length < height) selected.push(value);
      visited++;
      if (selected.length === height) return { rows: selected.reverse(), offset };
    }
  }
  return { rows: oldest.reverse(), offset: Math.min(offset, Math.max(0, visited - height)) };
}

export function createViewport<T extends { id: string }>({ capacity }: { capacity: number }) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("capacity must be a positive integer");
  const live = new Map<string, T>();
  let held: T[] | undefined;
  let position = 0;
  let unseen = 0;
  return {
    append(item: T): void {
      live.set(item.id, item);
      if (live.size > capacity) live.delete(live.keys().next().value!);
      if (held) unseen++;
    },
    scroll(delta: number): void {
      position = Math.max(0, position + Math.trunc(delta));
      if (position && !held) held = Array.from(live.values());
      if (!position) { held = undefined; unseen = 0; }
    },
    items(): readonly T[] { return held ?? Array.from(live.values()); },
    offset(): number { return position; },
    unseen(): number { return unseen; },
    find(predicate: (item: T) => boolean): number { return (held ?? Array.from(live.values())).findIndex(predicate); },
    follow(): void { position = 0; held = undefined; unseen = 0; }
  };
}
