import { afterEach, describe, expect, it, vi } from "vitest";
import { listWindowHint, resolveListWindow } from "./list-window.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveListWindow", () => {
  it("parses a limit and a since duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));

    expect(resolveListWindow({ limit: "5", since: "7d" })).toEqual({
      limit: 5,
      since: new Date("2026-07-09T12:00:00.000Z")
    });
  });

  it("drops the limit and since window for --all", () => {
    expect(resolveListWindow({ limit: "20", since: "7d", all: true })).toEqual({});
  });

  it("rejects a limit that is not a positive whole number", () => {
    expect(() => resolveListWindow({ limit: "0" })).toThrow(/--limit/);
    expect(() => resolveListWindow({ limit: "2.5" })).toThrow(/--limit/);
    expect(() => resolveListWindow({ limit: "many" })).toThrow(/--limit/);
  });
});

describe("listWindowHint", () => {
  it("hints at hidden entries once the limit is filled", () => {
    expect(listWindowHint({ limit: 20 }, 20, "jobs")).toContain("--all");
  });

  it("stays silent when nothing is capped", () => {
    expect(listWindowHint({ limit: 20 }, 19, "jobs")).toBeUndefined();
    expect(listWindowHint({}, 500, "jobs")).toBeUndefined();
  });
});
