import { describe, expect, it } from "vitest";
import { protocolHash, type HashProtocolContext } from "./hash-protocol.js";
import { ExecutionBudget } from "./execution-budget.js";

interface Value { integer?: bigint; hash?: (() => Value) | null }
const context: HashProtocolContext<Value> = {
  lookupHash: value => value.hash, integer: value => value.integer, typeName: () => "Guest"
};
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });

describe("guest hash protocol", () => {
  it.each([[-1n, -2n], [-2n, -2n], [1n, 1n], [(1n << 63n) - 1n, (1n << 63n) - 1n],
    [1n << 63n, 4n], [-(1n << 63n), -(1n << 63n)], [-(1n << 63n) - 1n, -5n], [1n << 100n, 549755813888n]])("normalizes integer hash %s", (integer, expected) => {
    expect(protocolHash({ hash: () => ({ integer }) }, context, budget())).toBe(expected);
  });
  it.each([undefined, null])("rejects missing or disabled hash slots: %s", hash => {
    expect(() => protocolHash({ hash }, context, budget())).toThrow("unhashable type: 'Guest'");
  });
  it("requires integer payloads without index coercion", () => {
    expect(() => protocolHash({ hash: () => ({}) }, context, budget())).toThrow("__hash__ method should return an integer");
  });
  it("preserves guest slot errors", () => {
    const failure = Error("hash failed");
    expect(() => protocolHash({ hash: () => { throw failure; } }, context, budget())).toThrow(failure);
  });
});
