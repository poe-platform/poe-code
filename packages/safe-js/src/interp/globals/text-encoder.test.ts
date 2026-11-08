import { expect, it } from "vitest";
import { run } from "../../run.js";
import { lint } from "../../lint.js";
import { Budget } from "../budget.js";
import { isSandboxClosure } from "../values.js";
import { createTextEncoderGlobal } from "./text-encoder.js";

it("encodes UTF-8 into guest Uint8Arrays and recognizes the global in lint", async () => {
  const source = `const encoder = new TextEncoder();
    return [encoder.encoding, Array.from(encoder.encode("abc")),
      Array.from(encoder.encode("é😀\\ud800")), encoder.encode() instanceof Uint8Array,
      encoder.encode(undefined).length, Object.prototype.toString.call(encoder)]`;
  expect(lint(source)).toEqual([]);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: [
    "utf-8", [97, 98, 99], [195, 169, 240, 159, 152, 128, 239, 191, 189], true, 0, "[object TextEncoder]",
  ] });
});

it("encodeInto preserves complete code points, reports UTF-16 reads, and writes into views", async () => {
  expect(await run(`const encoder = new TextEncoder(); const storage = new Uint8Array(8);
    storage.fill(42); const destination = storage.subarray(1, 6);
    const first = encoder.encodeInto("é😀", destination);
    const second = encoder.encodeInto("😀x", destination);
    return [first, second, Array.from(storage), encoder.encodeInto("é", new Uint8Array(1))]`))
    .toMatchObject({ ok: true, returnValue: [
      { read: 1, written: 2 }, { read: 3, written: 5 }, [42, 240, 159, 152, 128, 120, 42, 42],
      { read: 0, written: 0 },
    ] });
});

it("uses guest string coercion and validates receivers and destinations", async () => {
  expect(await run(`const encoder = new TextEncoder(); let calls = 0;
    const text = { toString() { calls++; return "é"; } };
    const encoded = Array.from(encoder.encode(text));
    const rejected = [];
    for (const action of [() => TextEncoder(), () => encoder.encode(Symbol()),
      () => TextEncoder.prototype.encode.call({}),
      () => encoder.encodeInto("x", new Uint16Array(2)),
      () => encoder.encodeInto("x", new Proxy(new Uint8Array(2), {}))]) {
      try { action(); rejected.push(false); } catch (error) { rejected.push(error instanceof TypeError); }
    }
    class Derived extends TextEncoder {} const derived = new Derived();
    return [encoded, calls, rejected, derived instanceof TextEncoder, derived instanceof Derived]`))
    .toMatchObject({ ok: true, returnValue: [[195, 169], 1, [true, true, true, true, true], true, true] });
});

it("exposes the standard constructor and enumerable prototype methods", async () => {
  expect(await run(`return [TextEncoder.length, TextEncoder.prototype.encode.length,
    TextEncoder.prototype.encodeInto.length, Object.keys(TextEncoder.prototype)]`))
    .toMatchObject({ ok: true, returnValue: [0, 0, 2, ["encoding", "encode", "encodeInto"]] });
});

it("checks encoded byte length against array limits before allocation", async () => {
  await expect(run('return new TextEncoder().encode("éé")', { budget: new Budget({ arrayLength: 3 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
});

it("matches native encodeInto for empty, detached, and Unicode destinations", async () => {
  for (const [text, length] of [
    ["", 0], ["abc", 0], ["é😀x", 3], ["é😀x", 5], ["é😀x", 8],
    ["\ud800", 2], ["\ud800", 3], ["\udc00", 3], ["a\ud800b", 4],
  ] as const) {
    const bytes = new Uint8Array(length);
    const result = new TextEncoder().encodeInto(text, bytes);
    expect(await run(`const bytes = new Uint8Array(${length});
      const result = new TextEncoder().encodeInto(${JSON.stringify(text)}, bytes);
      return [result, Array.from(bytes)]`))
      .toMatchObject({ ok: true, returnValue: [result, Array.from(bytes)] });
  }
  expect(await run(`const bytes = new Uint8Array(2);
    bytes.buffer.transfer(); return new TextEncoder().encodeInto("x", bytes)`))
    .toMatchObject({ ok: true, returnValue: { read: 0, written: 0 } });
});

it.each([
  [{ dataSize: 3 }, "dataSize"],
  [{ maxSteps: 1 }, "steps"],
] as const)("admits UTF-8 allocation and work through the supplied budget: %s", async (limits, name) => {
  const constructor = createTextEncoderGlobal(new Budget(limits));
  const instance = await constructor.construct!([]);
  const prototype = constructor.properties!.prototype;
  if (prototype === null || typeof prototype !== "object" || !("encode" in prototype) || !isSandboxClosure(prototype.encode))
    throw new Error("Missing TextEncoder encode method");
  await expect(prototype.encode.call(["éé"], { stack: [], thisValue: instance }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: name });
});
