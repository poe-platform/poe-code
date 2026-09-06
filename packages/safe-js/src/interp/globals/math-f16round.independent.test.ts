import { describe, expect, it, vi } from "vitest";

import capture from "../../../test/fixtures/regexp-compile-hash-ea469.json" with { type: "json" };
import { expectLegacyDumpGraph } from "../../../test/helpers/legacy-dump-graph.js";
import { dump } from "../../dump.js";
import { parse } from "../../parse.js";
import { hashSource } from "../../parse/hash.js";
import { restore, type SafeJSSnapshot } from "../../restore.js";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { declareHostOperation } from "../host-bridge.js";
import { interpret } from "../interpreter.js";
import { isSandboxRegex, type SandboxClosure, type SandboxValue } from "../values.js";
import { createMathGlobals } from "./math.js";

const nativeF16round = (Math as Math & { f16round?: (value: number) => number }).f16round;
const globals = createMathGlobals();
const f16round = globals.Math.f16round as SandboxClosure;

describe("Math.f16round independent review", () => {
  it("matches an integer-bit oracle on 36,864 exponent-stratified binary64 inputs", () => {
    const storage = new DataView(new ArrayBuffer(8));
    let comparisons = 0;
    for (let exponent = 0; exponent < 2048; exponent += 1) {
      for (const fraction of [0n, 1n, 0x7ffffffffffffn, 0x8000000000000n, 0xfffffffffffffn]) {
        storage.setBigUint64(0, (BigInt(exponent) << 52n) | fraction);
        const magnitude = storage.getFloat64(0);
        for (const value of [magnitude, -magnitude]) {
          assertSame(f16round.call([value]), roundByIntegerBits(value, storage), value);
          comparisons += 1;
        }
      }
    }
    let state = 0xa5b35719;
    for (let index = 0; index < 8192; index += 1) {
      state = Math.imul(state ^ (state >>> 15), 0x85ebca6b) >>> 0;
      storage.setUint32(0, ((985 + (index % 70)) << 20) | (state & 0xfffff));
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      storage.setUint32(4, state);
      const magnitude = storage.getFloat64(0);
      for (const value of [magnitude, -magnitude]) {
        assertSame(f16round.call([value]), roundByIntegerBits(value, storage), value);
        comparisons += 1;
      }
    }
    expect(comparisons).toBe(36_864);
  });

  it.skipIf(!nativeF16round)("matches native on 253,952 half values/tie neighbors", () => {
    const storage = new DataView(new ArrayBuffer(8)) as DataView & {
      getFloat16(byteOffset: number): number;
    };
    let comparisons = 0;
    for (let encoding = 0; encoding < 0x7c00; encoding += 1) {
      storage.setUint16(0, encoding);
      const lower = storage.getFloat16(0);
      storage.setUint16(0, encoding + 1);
      const upper = encoding === 0x7bff ? 65536 : storage.getFloat16(0);
      const midpoint = (lower + upper) / 2;
      storage.setFloat64(0, midpoint);
      const bits = storage.getBigUint64(0);
      const magnitudes = [lower];
      for (const offset of [-1n, 0n, 1n]) {
        storage.setBigUint64(0, bits + offset);
        magnitudes.push(storage.getFloat64(0));
      }
      for (const magnitude of magnitudes) {
        for (const value of [magnitude, -magnitude]) {
          assertSame(f16round.call([value]), nativeF16round!(value), value);
          comparisons += 1;
        }
      }
    }
    expect(comparisons).toBe(253_952);
  });

  it("distinguishes direct rounding from both binary32 double-rounding directions", () => {
    const storage = new DataView(new ArrayBuffer(8));
    for (const value of [1 + 2 ** -11 + 2 ** -52, 1 + 3 * 2 ** -11 - 2 ** -52]) {
      for (const signed of [value, -value]) {
        const expected = roundByIntegerBits(signed, storage);
        expect(f16round.call([signed])).toBe(expected);
        expect(roundByIntegerBits(Math.fround(signed), storage)).not.toBe(expected);
      }
    }
  });

  it("uses the existing numeric coercion protocol once and ignores extra operands", () => {
    for (const method of [f16round, globals.Math.fround as SandboxClosure]) {
      const hints: string[] = [];
      const argument = {
        [Symbol.toPrimitive](hint: string) {
          hints.push(hint);
          return "-0";
        },
        valueOf() {
          throw new Error("unexpected fallback");
        }
      };
      const ignored = {
        [Symbol.toPrimitive]() {
          throw new Error("unexpected extra-operand coercion");
        }
      };
      expect(method.call([argument, ignored] as unknown as SandboxValue[])).toBe(-0);
      expect(hints).toEqual(["number"]);
    }
  });

  it("propagates the original coercion exception without retrying", () => {
    const failure = new Error("conversion failed");
    let attempts = 0;
    const argument = {
      valueOf() {
        attempts += 1;
        throw failure;
      }
    };
    let caught: unknown;
    try {
      f16round.call([argument as unknown as SandboxValue]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(attempts).toBe(1);
  });

  it("matches fround accounting, ordinary arity and evaluated extra arguments", async () => {
    for (const args of [
      "",
      "'-0'",
      "null",
      "[]",
      "[2]",
      "{}",
      "32768",
      "65519",
      "65520",
      "Infinity",
      "NaN"
    ]) {
      const observations = [];
      for (const method of ["f16round", "fround"]) {
        const budget = new Budget({ maxSteps: 40 });
        const result = await interpret(parse(`return Math.${method}(${args})`), {
          bindings: globals,
          budget
        }).then(
          (value) => ({ ok: value.ok, stats: value.stats }),
          (error: unknown) => ({ error: String(error) })
        );
        observations.push({
          result,
          steps: budget.stepsUsed,
          depth: budget.peakCallDepth
        });
      }
      expect(observations[0]).toEqual(observations[1]);
    }
    let draws = 0;
    await expect(
      interpret(parse("return Math.f16round(1, Math.random())"), {
        bindings: createMathGlobals({
          random: () => {
            draws += 1;
            return 0.25;
          }
        }),
        budget: new Budget({ maxSteps: 40 })
      })
    ).resolves.toMatchObject({ ok: true, returnValue: 1 });
    expect(draws).toBe(1);
  });

  it("exhausts the same interpreter budget as fround at the maximum rounding loop", async () => {
    for (const method of ["f16round", "fround"]) {
      const budget = new Budget({ maxSteps: 40 });
      await expect(
        interpret(parse(`while (true) { Math.${method}(65519); }`), { bindings: globals, budget })
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps", current: 41, limit: 40 });
      expect(budget.stepsUsed).toBe(41);
    }
  });

  it("executes the README half-precision example unchanged", async () => {
    await expect(
      interpret(
        parse("return [Math.f16round(1.337), Math.f16round(1 + 2 ** -11), Math.f16round(65520)];"),
        {
          bindings: globals,
          budget: new Budget({ maxSteps: 40 })
        }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: [1.3369140625, 1, Infinity] });
  });

  it("replays untouched EA checkpoints with explicitly enumerated intrinsic additions", async () => {
    const captureBytes = JSON.stringify(capture);
    expect(capture.base).toBe("ea469259a7d61ab2839457863c445bd9f95155cb");
    expect(capture.expected).toStrictEqual([true, "a", "g", 1, 17]);
    expect(capture.pending.sourceHash).toBe(hashSource(capture.source));
    expect(capture.completed.sourceHash).toBe(capture.pending.sourceHash);
    const expected = {
      ...capture.completed,
      bindings: {
        ...capture.completed.bindings,
        Symbol: { kind: "fn", name: "Symbol" },
        BigInt: { kind: "fn", name: "BigInt" },
        Date: { kind: "fn", name: "Date" },
        URIError: { kind: "fn", name: "URIError" },
        EvalError: { kind: "fn", name: "EvalError" },
        encodeURI: { kind: "fn", name: "encodeURI" },
        encodeURIComponent: { kind: "fn", name: "encodeURIComponent" },
        decodeURI: { kind: "fn", name: "decodeURI" },
        decodeURIComponent: { kind: "fn", name: "decodeURIComponent" },
        Object: { kind: "fn", name: "Object" },
        JSON: {
          ...capture.completed.bindings.JSON,
          rawJSON: { kind: "fn", name: "rawJSON" },
          isRawJSON: { kind: "fn", name: "isRawJSON" }
        },
        Math: {
          ...capture.completed.bindings.Math,
          f16round: { kind: "fn", name: "f16round" }
        }
      }
    };
    for (const kind of ["pending", "completed"] as const) {
      const snapshot: SafeJSSnapshot = capture[kind];
      const before = JSON.stringify(snapshot);
      expect(snapshot).not.toHaveProperty("bindings.Math.f16round");
      const waitCalls = vi.fn();
      const wait = async () => {
        waitCalls();
        return 17;
      };
      const provider = vi.fn();
      expect(restore(snapshot, { source: capture.source })).toBe(snapshot);
      const result = await run(capture.source, {
        snapshot,
        budget: new Budget({ maxSteps: 10000 }),
        bindings: { wait: declareHostOperation(wait, "re-issue") },
        hostCallResumeProvider: provider
      });
      expect(result).toMatchObject({ ok: true, returnValue: [true, "a", "g", 1, 17] });
      expect(result.snapshot.sourceHash).toBe(capture.completed.sourceHash);
      const regex = result.snapshot.bindings.regex;
      const pair = result.snapshot.bindings.pair;
      expect(isSandboxRegex(regex)).toBe(true);
      expect(regex).toMatchObject({ source: "a", flags: "g", lastIndex: 1 });
      expect(Array.isArray(pair)).toBe(true);
      if (!Array.isArray(pair)) throw new Error("Missing regex alias pair");
      expect(pair[0]).toBe(regex);
      expect(pair[1]).toBe(regex);
      const serialized = JSON.parse(await dump(result));
      expect(restore(serialized, { source: capture.source })).toBe(serialized);
      expectLegacyDumpGraph(serialized, expected);
      const { version: ignoredVersion, bindings: ignoredBindings, heap: ignoredHeap, ...legacyMetadata } = expected;
      const { version, bindings: ignoredNewBindings, heap: ignoredNewHeap, ...metadata } = serialized;
      expect(version).toBe(2);
      expect(metadata, kind).toStrictEqual(legacyMetadata);
      expect(waitCalls).toHaveBeenCalledTimes(kind === "pending" ? 1 : 0);
      expect(provider).not.toHaveBeenCalled();
      expect(JSON.stringify(snapshot)).toBe(before);
    }
    expect(JSON.stringify(capture)).toBe(captureBytes);
  });
});

function roundByIntegerBits(value: number, storage: DataView): number {
  storage.setFloat64(0, value);
  const bits = storage.getBigUint64(0);
  const negative = bits >> 63n !== 0n;
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & 0xfffffffffffffn;
  if (exponent === 2047) {
    return fraction === 0n ? (negative ? -Infinity : Infinity) : NaN;
  }
  const significand = exponent === 0 ? fraction : (1n << 52n) | fraction;
  const sourcePower = exponent === 0 ? -1074 : exponent - 1075;
  const targetPower = Math.max(-24, exponent - 1033);
  const discarded = BigInt(targetPower - sourcePower);
  let integer = significand >> discarded;
  const remainder = significand - (integer << discarded);
  const halfway = 1n << (discarded - 1n);
  if (remainder > halfway || (remainder === halfway && (integer & 1n) !== 0n)) {
    integer += 1n;
  }
  const magnitude = Number(integer) * 2 ** targetPower;
  const rounded = magnitude > 65504 ? Infinity : magnitude;
  return negative ? -rounded : rounded;
}

function assertSame(actual: unknown, expected: number, value: number): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`input=${value}, expected=${expected}, actual=${String(actual)}`);
  }
}
