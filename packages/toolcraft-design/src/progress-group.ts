import { plainTerminalText } from "./dashboard/ansi.js";
import { fitToWidth } from "./explorer/render/text.js";

export interface ProgressItem { label: string; completed?: number; total?: number; status?: "running" | "success" | "error" }
export function renderProgressGroup(items: readonly ProgressItem[], width: number): string[] {
  return items.map(item => {
    const known = item.total !== undefined && item.total > 0 && Number.isFinite(item.total) && item.completed !== undefined && Number.isFinite(item.completed);
    const progress = known ? `${Math.round(Math.max(0, Math.min(1, item.completed! / item.total!)) * 100)}%` : "…";
    const marker = item.status === "success" ? "✓" : item.status === "error" ? "■" : "●";
    return fitToWidth(`${marker} ${plainTerminalText(item.label)} ${progress}`, width);
  });
}
