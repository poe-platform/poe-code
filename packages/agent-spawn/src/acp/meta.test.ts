import { describe, expect, it } from "vitest";

import { stampReceiveTime } from "./meta.js";

describe("stampReceiveTime", () => {
  it("adds _meta.ts when no _meta is present", () => {
    const event: { event: string; _meta?: Record<string, unknown> } = {
      event: "agent_message",
    };

    stampReceiveTime(event, 1000);

    expect(event._meta).toEqual({ ts: 1000 });
  });

  it("preserves existing _meta.ts (only stamps once)", () => {
    const event: { event: string; _meta?: Record<string, unknown> } = {
      event: "agent_message",
      _meta: { ts: 500 },
    };

    stampReceiveTime(event, 1000);

    expect(event._meta?.ts).toBe(500);
  });

  it("preserves existing _meta keys when adding ts", () => {
    const event: { event: string; _meta?: Record<string, unknown> } = {
      event: "tool_start",
      _meta: { raw: { foo: 1 }, toolName: "Bash" },
    };

    stampReceiveTime(event, 1000);

    expect(event._meta).toEqual({ raw: { foo: 1 }, toolName: "Bash", ts: 1000 });
  });

  it("returns non-object inputs unchanged", () => {
    expect(stampReceiveTime(null, 1)).toBeNull();
    expect(stampReceiveTime(undefined, 1)).toBeUndefined();
    expect(stampReceiveTime("x" as unknown as object, 1)).toBe("x");
  });
});
