import { describe, expect, it } from "vitest";
import { suggest } from "./suggest.js";

describe("suggest", () => {
  it("suggests exact distance-1 typos", () => {
    expect(suggest("widgts", ["widgets", "deploy"])).toEqual(["widgets"]);
  });

  it("does not suggest distance-3 typos for short inputs", () => {
    expect(suggest("abc", ["xyz"])).toEqual([]);
  });

  it("returns no suggestions for empty input", () => {
    expect(suggest("", ["widgets"])).toEqual([]);
  });

  it("sorts by distance then alphabetically and caps suggestions", () => {
    expect(suggest("namee", ["namespace", "name", "names", "named"], { threshold: 4 })).toEqual([
      "name",
      "named",
      "names"
    ]);
  });
});
