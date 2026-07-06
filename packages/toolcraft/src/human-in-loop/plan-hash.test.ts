import { describe, expect, it } from "vitest";
import { createApprovalPlan } from "./plan-hash.js";

describe("createApprovalPlan", () => {
  it("hashes objects deterministically regardless of field insertion order", () => {
    const first = createApprovalPlan({
      delete: ["flows/old.json"],
      update: { path: "flows/morning.json", revision: 2 }
    });
    const second = createApprovalPlan({
      update: { revision: 2, path: "flows/morning.json" },
      delete: ["flows/old.json"]
    });

    expect(first).toEqual(second);
    expect(first.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.canonical).toBe(
      '{"delete":["flows/old.json"],"update":{"path":"flows/morning.json","revision":2}}'
    );
  });

  it("rejects nondeterministic or non-JSON plan values", () => {
    expect(() => createApprovalPlan({ generatedAt: new Date() })).toThrowError(
      "Approval plan must contain only JSON values."
    );
    expect(() => createApprovalPlan({ value: Number.NaN })).toThrowError(
      "Approval plan numbers must be finite."
    );
  });
});
