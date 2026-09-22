import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { parsePdfObjects, resolvePdfReference, PdfSyntaxError } from "./index.js";

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const parse = (s: string, options = {}) => parsePdfObjects(bytes(s), options);
test("strict scalar grammar, comments and source spans", () => {
  const result = parse("%comment\r\n\0+12 -.5 1. true false null /A#20#2f#00");
  assert.deepEqual(
    result.map((x) => x.kind),
    ["number", "number", "number", "boolean", "boolean", "null", "name"]
  );
  assert.equal(result[0]?.start, 11);
  assert.equal(result[0]?.end, 14);
  assert.deepEqual(result.at(-1)?.bytes, bytes("A /\0"));
  for (const bad of [
    "--2",
    "1-2",
    "+",
    ".",
    "-",
    "1e3",
    "True",
    ")",
    "9007199254740993",
    "/#GG",
    "/#"
  ]) {
    assert.throws(() => parse(bad), PdfSyntaxError, bad);
  }
});
test("literal strings retain raw bytes and normalize only PDF line endings", () => {
  const source = bytes("(a(b)c\\n\\101\\777\\\r\nx\r\ny\rz\n\\q)");
  const value = parsePdfObjects(source)[0]!;
  assert.deepEqual(value.bytes, bytes("a(b)c\nA\xffx\ny\nz\nq"));
  assert.deepEqual(value.raw, source);
  assert.deepEqual(
    parsePdfObjects(Uint8Array.of(40, 255, 128, 41))[0]?.bytes,
    Uint8Array.of(255, 128)
  );
  for (const s of ["(abc", "(abc\\", "<z>", "<6", "<"])
    assert.throws(() => parse(s), PdfSyntaxError);
  assert.deepEqual(parse("< 6 1 2 >")[0]?.bytes, Uint8Array.of(0x61, 0x20));
});
test("arrays, byte-key dictionaries, duplicate policy and null retention", () => {
  const dict = parse("<< /A 1 /#41 2 /B null /Bin#ff [true (x)] >>")[0]!;
  assert.equal(dict.entries?.length, 4);
  assert.equal(dict.entries?.[1]?.value.value, 2);
  assert.equal(dict.entries?.[2]?.value.kind, "null");
  assert.equal(dict.entries?.[0]?.key.start, 3);
  assert.throws(() => parse("<< /A 1 /#41 2 >>", { duplicateKeys: "reject" }), /duplicate/);
  for (const bad of ["[1", "<< /A 1", "<< A 1 >>", "<< /A >>", "]", ">>"])
    assert.throws(() => parse(bad));
});
test("references require nonnegative safe integers and bounded generations", () => {
  const ref = parse("12 0 R")[0]!;
  assert.equal(ref.kind, "reference");
  assert.equal(ref.objectNumber, 12);
  assert.equal(ref.generation, 0);
  assert.equal(ref.end, 6);
  assert.deepEqual(ref.raw, bytes("12 0 R"));
  for (const bad of ["-1 0 R", "1 -1 R", "1 65536 R", "1.0 0 R", "1 .5 R"])
    assert.throws(() => parse(bad));
  assert.deepEqual(
    parse("1 2 3").map((x) => x.value),
    [1, 2, 3]
  );
  assert.throws(() => resolvePdfReference(ref, () => ref), /cycle/);
  const other = parse("13 0 R")[0]!;
  assert.throws(
    () => resolvePdfReference(ref, (r) => (r.objectNumber === 12 ? other : ref)),
    /cycle/
  );
  assert.equal(resolvePdfReference(ref, () => parse("null")[0]!).kind, "null");
});
test("every chunk boundary is byte invariant", () => {
  const input = bytes("%a\r\n[12 0 R /A#20 (a\\\r\nb\\101(c)) <123> << /K false >>]");
  const expected = parsePdfObjects(input);
  for (let i = 0; i <= input.length; i++)
    assert.deepEqual(parsePdfObjects([input.subarray(0, i), input.subarray(i)]), expected);
  assert.deepEqual(parsePdfObjects(Array.from(input, (b) => Uint8Array.of(b))), expected);
});
test("quotas, offsets, cancellation and reference work are fatal", () => {
  for (const [input, limits] of [
    ["123", { inputBytes: 2 }],
    ["(abc)", { tokenBytes: 4 }],
    ["[[0]]", { nesting: 1 }],
    ["[1 2]", { objects: 2 }],
    ["%abcdef", { work: 2 }],
    ["(abc)", { retainedBytes: 2 }]
  ] as const) {
    assert.throws(
      () => parse(input, { limits }),
      (e: unknown) => e instanceof PdfSyntaxError && e.code === "LIMIT"
    );
  }
  for (const limits of [{ work: -1 }, { objects: Infinity }, { nesting: 10000 }])
    assert.throws(() => parse("0", { limits }));
  for (const offset of [-1, 0.5, 2, Number.MAX_SAFE_INTEGER])
    assert.throws(() => parse("0", { offset }));
  assert.equal(parse(" 0", { offset: 1 })[0]?.start, 1);
  const controller = new AbortController();
  const reason = new Error("cancelled");
  controller.abort(reason);
  assert.throws(
    () => parse("0", { signal: controller.signal }),
    (e) => e === reason
  );
  const ref = parse("1 0 R")[0]!;
  assert.throws(
    () =>
      resolvePdfReference(ref, () => {
        throw reason;
      }),
    (e) => e === reason
  );
  assert.throws(() => resolvePdfReference(ref, () => ref, { maxReferences: 0 }), /limit/);
});
test("exact numeric bounds and cancellation inside reference lookup", () => {
  assert.throws(() => parse("9007199254740991.1"), /numeric range/);
  assert.equal(parse("9007199254740991.0")[0]?.value, Number.MAX_SAFE_INTEGER);
  assert.equal(parse("00012")[0]?.value, 12);
  assert.throws(() => parse("(())", { limits: { nesting: 1 } }), /nesting/);
  const controller = new AbortController(),
    reason = new Error("during lookup");
  assert.throws(
    () =>
      resolvePdfReference(
        parse("1 0 R")[0]!,
        () => {
          controller.abort(reason);
          return parse("null")[0]!;
        },
        { signal: controller.signal }
      ),
    (e) => e === reason
  );
});
test("reserved braces delimit names and cannot become name bytes without escapes", () => {
  for (const source of ["/A{", "/A}", "{/A", "}/A"])
    assert.throws(() => parse(source), PdfSyntaxError, source);
  assert.deepEqual(parse("/A#7b#7d")[0]?.bytes, bytes("A{}"));
});
test("input and returned byte buffers have independent ownership", () => {
  const input = bytes("[(abc) /Name <ff>]");
  const result = parsePdfObjects(input);
  input.fill(0);
  const literal = result[0]!.items![0]!;
  assert.deepEqual(literal.raw, bytes("(abc)"));
  assert.deepEqual(literal.bytes, bytes("abc"));
  literal.raw!.fill(0);
  assert.deepEqual(literal.bytes, bytes("abc"));
  assert.deepEqual(result[0]!.items![1]!.raw, bytes("/Name"));
});
test("byte admission uses intrinsic storage across realms and rejects other views", () => {
  const foreign = runInNewContext("Uint8Array.of(40, 255, 41)") as Uint8Array;
  assert.deepEqual(parsePdfObjects(foreign)[0]?.bytes, Uint8Array.of(255));
  assert.deepEqual(parsePdfObjects([foreign])[0]?.bytes, Uint8Array.of(255));
  class HiddenLength extends Uint8Array {
    override get length() { return 0; }
  }
  const hidden = new HiddenLength([49, 50, 51]);
  assert.equal(parsePdfObjects(hidden)[0]?.value, 123);
  assert.throws(
    () => parsePdfObjects(hidden, { limits: { inputBytes: 2 } }),
    (e: unknown) => e instanceof PdfSyntaxError && e.code === "LIMIT"
  );
  for (const input of [new Uint16Array([49]), new Uint8ClampedArray([49]), new DataView(new ArrayBuffer(1))]) {
    Object.defineProperty(input, Symbol.toStringTag, { value: "Uint8Array" });
    assert.throws(() => parsePdfObjects([input as unknown as Uint8Array]), PdfSyntaxError);
  }
});
test("independent exhaustive byte controls and malformed container corpus", () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  const encoded = Array.from(all, b => b.toString(16).padStart(2, "0"));
  assert.deepEqual(parse("/" + encoded.map(h => "#" + h).join(""))[0]?.bytes, all);
  assert.deepEqual(parse("<" + encoded.join(" \r\n") + ">")[0]?.bytes, all);
  assert.deepEqual(
    parse("(" + Array.from(all, b => "\\" + b.toString(8).padStart(3, "0")).join("") + ")")[0]?.bytes,
    all
  );
  const corpus = ["[>>]", "<< /K ] >>", "[1 0 R R]", "<< /K 1 /K >>", "<0g>", "/#0g", "(\\)"];
  for (const source of corpus) {
    const input = bytes(source);
    for (let split = 0; split <= input.length; split++) {
      assert.throws(
        () => parsePdfObjects([input.subarray(0, split), input.subarray(split)]),
        (e: unknown) => e instanceof PdfSyntaxError && e.code === "SYNTAX",
        source
      );
    }
  }
  const ref = parse("9007199254740991 65535 R")[0]!;
  assert.equal(ref.objectNumber, Number.MAX_SAFE_INTEGER);
  assert.equal(ref.generation, 65535);
  assert.throws(() => resolvePdfReference({ ...ref, generation: -1 }, () => parse("null")[0]!), /invalid reference/);
});
