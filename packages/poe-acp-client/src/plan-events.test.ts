import { describe, expect, it } from "vitest";
import { mapLegacyEventToSessionUpdates } from "./stream-helpers.js";

describe("agent checklist event replay", () => {
  it("maps checklist entries without changing their order, status, or priority", () => {
    const entries = [
      { content: "Inspect", status: "completed", priority: "low" },
      { content: "Implement", status: "in_progress", priority: "high" },
      { content: "Verify", status: "pending", priority: "medium" }
    ];
    expect(mapLegacyEventToSessionUpdates({ event: "plan", id: "agent-plan", entries }))
      .toEqual([{ sessionUpdate: "plan", entries }]);
    expect(mapLegacyEventToSessionUpdates({ event: "plan", entries: [] }))
      .toEqual([{ sessionUpdate: "plan", entries: [] }]);
  });

  it.each([null, {}, [null], [{ content: "Inspect", status: "finished", priority: "medium" }],
    [{ content: 12, status: "pending", priority: "medium" }], [{ content: "Inspect", status: "pending", priority: "urgent" }]])(
    "ignores malformed checklists instead of clearing the current plan", (entries) => {
      expect(mapLegacyEventToSessionUpdates({ event: "plan", entries })).toEqual([]);
    }
  );
});
