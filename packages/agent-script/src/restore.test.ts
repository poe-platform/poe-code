import { describe, expect, it } from "vitest";

import { hashSource } from "./parse/hash.js";
import { restore } from "./restore.js";

describe("restore", () => {
  it("accepts snapshots whose source hash matches the current source", () => {
    const snapshot = {
      version: 1,
      sourceHash: hashSource("1 + 2"),
      callStack: []
    };

    expect(restore(snapshot, { source: "1 + 2" })).toBe(snapshot);
  });

  it("accepts snapshots when only formatting and raw literal syntax change", () => {
    const snapshot = {
      version: 1,
      sourceHash: hashSource("({ value = 0x1f }) => `hi ${value}`")
    };

    expect(
      restore(snapshot, {
        source: "({value = 31}) => `hi ${ value }`"
      })
    ).toBe(snapshot);
  });

  it("rejects snapshots when the source hash no longer matches", () => {
    const snapshot = {
      version: 1,
      sourceHash: hashSource("1 + 2")
    };

    expect(() => restore(snapshot, { source: "1 + 3" })).toThrowError(
      `source changed since snapshot was taken (hash ${snapshot.sourceHash} expected, got ${hashSource("1 + 3")}); pass --reset to discard`
    );
  });

  it("rejects snapshots when the parsed structure changes despite similar source", () => {
    const snapshot = {
      version: 1,
      sourceHash: hashSource("user?.profile")
    };

    expect(() => restore(snapshot, { source: "user.profile" })).toThrowError(
      `source changed since snapshot was taken (hash ${snapshot.sourceHash} expected, got ${hashSource("user.profile")}); pass --reset to discard`
    );
  });
});
