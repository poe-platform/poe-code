import { describe, expect, it } from "vitest";
import { SeededPayloadHash } from "./seeded-payload-hash.js";
import { ConstantValues } from "./constant-values.js";
import { constantHash } from "./constant-hash.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { CodePointString } from "./code-point-string.js";
import { ImmutableBytes } from "./immutable-bytes.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  return { meter, hash: new SeededPayloadHash(0n, 0n) };
}

describe("seeded immutable payload hashes", () => {
  it("matches CPython zero-key byte hashes across block boundaries", () => {
    const { meter, hash } = fixture();
    expect(hash.bytes(ImmutableBytes.copyOf(new Uint8Array(), meter), meter)).toBe(0n);
    expect(hash.bytes(ImmutableBytes.copyOf(Uint8Array.of(97, 98, 99), meter), meter)).toBe(-4594863902769663758n);
    expect(hash.bytes(ImmutableBytes.copyOf(Uint8Array.from({ length: 8 }, (_, i) => i), meter), meter)).toBe(-1525574692105212182n);
  });
  it("hashes strings as compact code points rather than UTF-8 or UTF-16", () => {
    const { meter, hash } = fixture();
    const latin = new CodePointString(Uint32Array.of(233));
    expect(hash.string(latin, meter)).toBe(hash.bytes(ImmutableBytes.copyOf(Uint8Array.of(233), meter), meter));
    const wide = new CodePointString(Uint32Array.of(65, 256));
    expect(hash.string(wide, meter)).toBe(hash.bytes(ImmutableBytes.copyOf(Uint8Array.of(65, 0, 0, 1), meter), meter));
    const astral = new CodePointString(Uint32Array.of(65, 0x1f600));
    expect(hash.string(astral, meter)).toBe(hash.bytes(ImmutableBytes.copyOf(Uint8Array.of(65, 0, 0, 0, 0, 246, 1, 0), meter), meter));
    const surrogate = new CodePointString(Uint32Array.of(0xd800));
    expect(hash.string(surrogate, meter)).toBe(hash.bytes(ImmutableBytes.copyOf(Uint8Array.of(0, 216), meter), meter));
  });
  it("requires explicit unsigned 128-bit key material", () => {
    expect(() => new SeededPayloadHash(-1n, 0n)).toThrow(RangeError);
    expect(() => new SeededPayloadHash(0n, 1n << 64n)).toThrow(RangeError);
    const { meter, hash } = fixture(), payload = new CodePointString(Uint32Array.of(97));
    expect(new SeededPayloadHash(1n, 2n).string(payload, meter)).not.toBe(hash.string(payload, meter));
  });
  it("streams payloads with fixed charged workspace, not payload-sized copies", () => {
    const { meter, hash } = fixture(), value = ImmutableBytes.copyOf(new Uint8Array(1000), meter);
    const before = meter.usage.allocatedBytes;
    hash.bytes(value, meter);
    expect(meter.usage.allocatedBytes - before).toBe(32);
  });
  it("honors limits for empty inputs and during payload traversal", () => {
    const { hash, meter } = fixture(), empty = ImmutableBytes.copyOf(new Uint8Array(), meter);
    expect(() => hash.bytes(empty, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
    const value = new CodePointString(new Uint32Array(100));
    expect(() => hash.string(value, new ExecutionBudget({ maxSteps: 3, maxAllocatedBytes: 1000 }))).toThrow(ExecutionLimitError);
    expect(() => hash.bytes(ImmutableBytes.copyOf(Uint8Array.of(1), meter), new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
  it("connects seeded payloads to nested constant hashing", () => {
    const { meter, hash } = fixture(), values = new ConstantValues(meter);
    const context = { identity: () => 1n, string: hash.string.bind(hash), bytes: hash.bytes.bind(hash) };
    expect(constantHash(values.tuple([values.string("abc")]), context, meter)).toBe(constantHash(values.tuple([values.bytes(Uint8Array.of(97, 98, 99))]), context, meter));
  });
});
