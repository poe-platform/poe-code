import { expect, it } from "vitest";
import { createEventGroups } from "./event-groups.js";

it("bounds grouped events and reveals errors", () => {
  const groups = createEventGroups({ capacity: 2, children: 2 });
  groups.append("tools", { id: "a", text: "first" }); groups.append("tools", { id: "b", text: "failed", error: true });
  expect(groups.rows(0, 3).map(x => x.text)).toEqual(["tools", "first", "failed"]);
  groups.toggle("tools"); expect(groups.rows(0, 3)).toHaveLength(1);
  groups.append("tools", { id: "c", text: "again", error: true }); expect(groups.rows(0, 3).map(x => x.text)).toEqual(["tools", "failed", "again"]);
});
it("bounds large output previews", () => {
  const groups = createEventGroups({ capacity: 1, children: 1 });
  groups.append("tool", { id: "huge", text: "x".repeat(100000), error: true });
  expect(groups.rows(0, 2)[1]!.text.length).toBeLessThanOrEqual(16384);
});

it("renders collapse and error markers", async () => {
  const { renderEventGroupRows } = await import("./event-groups.js");
  expect(renderEventGroupRows([{ id: "a", groupId: "a", text: "Tools", header: true, expanded: false }, { id: "b", groupId: "a", text: "Failed", error: true }], 40)).toEqual(["▸ Tools", "  ■ Failed"]);
});

it("keeps output previews on one safe terminal row", async () => {
  const { renderEventGroupRows } = await import("./event-groups.js");
  expect(renderEventGroupRows([{ id: "a", groupId: "a", text: "First\nSecond\x1b[2J" }], 40)).toEqual(["  │ First Second"]);
});
