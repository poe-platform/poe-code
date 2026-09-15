import { plainTerminalText } from "./dashboard/ansi.js";
import { limitOutputPreview } from "./dashboard/output-preview.js";
import { fitToWidth } from "./explorer/render/text.js";

export interface InlineNotice { level: "info" | "success" | "warning" | "error"; text: string }
export function renderNotice(notice: InlineNotice, width: number): string {
  const marker = { info: "●", success: "✓", warning: "▲", error: "■" }[notice.level];
  return fitToWidth(`${marker} ${plainTerminalText(notice.text)}`, width);
}

/** Notices expire during reads, so an idle terminal needs no repaint timer. */
export function createNotices({ capacity, now = () => performance.now() }: { capacity: number; now?: () => number }) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("positive capacity required");
  const notices = new Map<string, { notice: InlineNotice; expires: number }>();
  return {
    put(id: string, notice: InlineNotice, durationMs = Infinity): void {
      notices.set(id, { notice: { ...notice, text: limitOutputPreview(notice.text) }, expires: now() + Math.max(0, durationMs) });
      if (notices.size > capacity) notices.delete(notices.keys().next().value!);
    },
    dismiss(id: string): void { notices.delete(id); },
    list(): InlineNotice[] {
      const time = now();
      for (const [id, entry] of notices) if (entry.expires <= time) notices.delete(id);
      return Array.from(notices.values(), entry => ({ ...entry.notice }));
    }
  };
}
