import { describe, expect, it } from "vitest";
import { ExecutionIdentity } from "./execution-identity.js";
import { ExecutionBudget } from "./execution-budget.js";

describe("execution-local object identity", () => {
  it("keeps identities stable and distinguishes structurally equal objects", () => {
    const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1000 }), identity = new ExecutionIdentity(meter);
    const a = {}, b = {}, first = identity.id(a), allocated = meter.usage.allocatedBytes;
    expect(identity.id(a)).toBe(first); expect(meter.usage.allocatedBytes).toBe(allocated);
    expect(identity.id(b)).not.toBe(first);
    expect(identity.hash(a)).toBe(identity.hash(a));
    expect(identity.hash(b)).not.toBe(identity.hash(a));
  });
  it("isolates identity allocation order between executions", () => {
    const budget = () => new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1000 });
    const first = new ExecutionIdentity(budget()), second = new ExecutionIdentity(budget()), a = {}, b = {};
    expect(first.id(a)).toBe(second.id(b));
    expect(first.id(b)).toBe(second.id(a));
  });
  it("charges new identities before retaining them", () => {
    const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 64 }), identity = new ExecutionIdentity(meter);
    expect(() => identity.id({})).toThrow("execution allocation limit exceeded");
  });
});
