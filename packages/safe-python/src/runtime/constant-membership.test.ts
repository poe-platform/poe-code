import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { constantMembership } from "./constant-membership.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete membership", () => {
  it("searches strings as code-point substrings, including empty strings", () => {
    const { meter, values: v } = fixture();
    expect(constantMembership("in", v.string(""), v.string(""), v, meter)).toBe(v.true);
    expect(constantMembership("in", v.string("bc"), v.string("abcd"), v, meter)).toBe(v.true);
    expect(constantMembership("not in", v.string("bd"), v.string("abcd"), v, meter)).toBe(v.true);
    expect(constantMembership("in", v.stringPoints(Uint32Array.of(0xd800)), v.stringPoints(Uint32Array.of(0x10000)), v, meter)).toBe(v.false);
  });
  it("requires string needles even for empty haystacks", () => {
    const { meter, values: v } = fixture();
    expect(() => constantMembership("in", v.none, v.string(""), v, meter)).toThrow("'in <string>' requires string as left operand, not NoneType");
    expect(() => constantMembership("not in", v.bytes(new Uint8Array()), v.string(""), v, meter)).toThrow("'in <string>' requires string as left operand, not bytes");
  });
  it("searches bytes by subsequence or integer byte value", () => {
    const { meter, values: v } = fixture(), bytes = v.bytes(Uint8Array.of(0, 1, 255));
    expect(constantMembership("in", v.bytes(Uint8Array.of(1, 255)), bytes, v, meter)).toBe(v.true);
    expect(constantMembership("in", v.bytes(new Uint8Array()), bytes, v, meter)).toBe(v.true);
    expect(constantMembership("in", v.integer(255), bytes, v, meter)).toBe(v.true);
    expect(constantMembership("in", v.true, bytes, v, meter)).toBe(v.true);
    expect(constantMembership("not in", v.integer(2), bytes, v, meter)).toBe(v.true);
  });
  it("validates integer byte bounds before searching even an empty buffer", () => {
    const { meter, values: v } = fixture(), empty = v.bytes(new Uint8Array());
    for (const number of [-1n, 256n, 1n << 10000n]) expect(() => constantMembership("in", v.integer(number), empty, v, meter)).toThrow(expect.objectContaining({ name: "ValueError", message: "byte must be in range(0, 256)" }));
    expect(() => constantMembership("in", v.float(1), empty, v, meter)).toThrow("a bytes-like object is required, not 'float'");
  });
  it("uses member identity then equality for tuples", () => {
    const { meter, values: v } = fixture(), nan = v.float(NaN), tuple = v.tuple([nan, v.integer(1), v.tuple([v.integer(2)])]);
    expect(constantMembership("in", nan, tuple, v, meter)).toBe(v.true);
    expect(constantMembership("in", v.float(NaN), tuple, v, meter)).toBe(v.false);
    expect(constantMembership("in", v.true, tuple, v, meter)).toBe(v.true);
    expect(constantMembership("in", v.tuple([v.float(2)]), tuple, v, meter)).toBe(v.true);
    expect(constantMembership("in", v.notImplemented, v.tuple([v.notImplemented]), v, meter)).toBe(v.true);
  });
  it("rejects noncontainers with Python type names", () => {
    const { meter, values: v } = fixture();
    expect(() => constantMembership("in", v.none, v.none, v, meter)).toThrow("argument of type 'NoneType' is not a container or iterable");
    expect(() => constantMembership("not in", v.none, v.integer(1), v, meter)).toThrow("argument of type 'int' is not a container or iterable");
  });
  it("uses metered linear byte search without copying private payloads", () => {
    const { meter, values: v } = fixture(), haystack = v.bytes(new Uint8Array(5000).fill(97)), needle = v.bytes(Uint8Array.of(97, 97, 98));
    const before = meter.usage;
    expect(haystack.value.contains(needle.value, meter)).toBe(false);
    expect(meter.usage.allocatedBytes - before.allocatedBytes).toBe(12);
    expect(meter.usage.steps - before.steps).toBeLessThan(15010);
    const searchMeter = new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 100 });
    expect(() => haystack.value.contains(needle.value, searchMeter)).toThrow(ExecutionLimitError);
  });
  it("checks fatal limits and rejects unknown operators", () => {
    const { meter, values: v } = fixture();
    expect(() => constantMembership("in", v.none, v.tuple([]), v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
    expect(() => constantMembership("==", v.none, v.none, v, meter)).toThrow("unsupported constant membership operator: ==");
  });
});
