import { fitToWidth } from "./explorer/render/text.js";

export function createMetric({ capacity, unit }: { capacity: number; unit: string }) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("positive capacity required");
  const values: (number | null)[] = Array(capacity).fill(null); let count = 0; let cursor = 0;
  return {
    push(value: number | null): void { values[cursor] = value !== null && Number.isFinite(value) ? value : null; cursor = (cursor + 1) % capacity; count = Math.min(count + 1, capacity); },
    samples(): (number | null)[] { return Array.from({ length: count }, (_, i) => values[(cursor - count + i + capacity) % capacity]!); },
    render(width: number): string {
      const samples = Array.from({ length: Math.min(count, Math.max(0, width)) }, (_, i) => values[(cursor - Math.min(count, Math.max(0, width)) + i + capacity) % capacity]!);
      const known = samples.filter((value): value is number => value !== null);
      const min = Math.min(...known); const max = Math.max(...known);
      const spark = samples.map(value => value === null ? "·" : "▁▂▃▄▅▆▇█"[max === min ? 3 : Math.round((value - min) / (max - min) * 7)]).join("");
      const latest = count ? values[(cursor - 1 + capacity) % capacity] : null;
      return fitToWidth(`${latest ?? "—"} ${unit} ${spark}`, width);
    }
  };
}
