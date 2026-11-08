import { expect, it } from "vitest";
import { createNotices } from "./inline-notice.js";

it("coalesces notices by key and expires without timers", () => {
  let now = 0; const notices = createNotices({ capacity: 2, now: () => now });
  notices.put("retry", { level: "warning", text: "one" }, 10); notices.put("retry", { level: "warning", text: "two" }, 10);
  expect(notices.list()).toHaveLength(1); now = 11; expect(notices.list()).toEqual([]);
});
it("renders a fitted warning without taking focus", async () => {
  const { renderNotice } = await import("./inline-notice.js");
  expect(renderNotice({ level: "warning", text: "Retrying" }, 30)).toContain("Retrying");
});

it("keeps inline messages to one safe row and bounds stored text", async () => {
  const { renderNotice } = await import("./inline-notice.js");
  expect(renderNotice({ level: "info", text: "First\nSecond\x1b[2J" }, 40)).toBe("● First Second");
  const notices = createNotices({ capacity: 1 }); notices.put("large", { level: "info", text: "x".repeat(100000) });
  expect(notices.list()[0]!.text.length).toBeLessThanOrEqual(16384);
});
