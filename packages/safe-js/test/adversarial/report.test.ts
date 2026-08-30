import { describe, expect, it } from "vitest";

import { minimizeSnapshot, minimizeSource } from "./report.js";

describe("adversarial reproducer minimization", () => {
  it("removes source lines while preserving the failure predicate", () => {
    const minimized = minimizeSource(
      "const unused = 1;\nthrow target;\nconst extra = 2;",
      (source) => source.includes("throw target;")
    );

    expect(minimized).toBe("throw target;");
  });

  it("removes snapshot keys while preserving the failure predicate", () => {
    const minimized = minimizeSnapshot(
      { sourceHash: "valid", clock: { next: 1 }, broken: true },
      (snapshot) => snapshot.broken === true
    );

    expect(JSON.parse(minimized)).toEqual({ broken: true });
  });
});
