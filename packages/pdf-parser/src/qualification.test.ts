import { test } from "node:test";
import assert from "node:assert/strict";
import { openPdf, parsePdfObjects, decodePdfStream, PdfSyntaxError } from "./index.js";

const bytes = (source: string) => Uint8Array.from(source, c => c.charCodeAt(0));
const limits = { inputBytes: 4096, tokenBytes: 1024, objects: 128, nesting: 16,
  retainedBytes: 65536, expandedBytes: 4096, work: 65536 };

// Original fixtures, no copied document content or upstream parser implementation.
function page(version: string, rotate: number) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 72 144] /Rotate ${rotate} >>`,
    "<< /Type /Page /Parent 2 0 R /Resources << >> >>"
  ];
  let source = `%PDF-${version}\n`;
  const offsets = objects.map((object, index) => {
    const offset = source.length;
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = source.length;
  source += "xref\n0 4\n0000000000 65535 f\n";
  for (const offset of offsets) source += `${String(offset).padStart(10, "0")} 00000 n\n`;
  return bytes(source + `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

test("original classic page corpus: PDF 1.0–2.0 headers and inherited rotation", () => {
  for (const version of ["1.0", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "2.0"]) {
    for (const rotate of [0, 90, 180, 270]) {
      const input = page(version, rotate);
      const snapshot = input.slice();
      const document = openPdf(input, { limits });
      const inventory = document.inspectPages();
      assert.equal(inventory.pageCount, 1);
      assert.equal(inventory.pages[0]!.rotate, rotate);
      assert.deepEqual(inventory.pages[0]!.mediaBox, [0, 0, 72, 144]);
      assert.equal(openPdf(input, { limits }).extractPageText(0).text, "");
      assert.deepEqual(input, snapshot);
    }
  }
});

type Outcome = { value: unknown } | { code: string; offset: number };
function syntaxOutcome(input: Uint8Array | readonly Uint8Array[]): Outcome {
  try { return { value: parsePdfObjects(input, { limits }) }; }
  catch (error) {
    if (!(error instanceof PdfSyntaxError)) throw error;
    return { code: error.code, offset: error.offset };
  }
}

// Deterministic deletion minimization; predicate must retain the same failure class.
function minimize(input: Uint8Array, fails: (candidate: Uint8Array) => boolean) {
  let result = input;
  for (let width = Math.ceil(result.length / 2); width >= 1; width = Math.floor(width / 2)) {
    for (let start = 0; start < result.length;) {
      const candidate = new Uint8Array([...result.subarray(0, start), ...result.subarray(start + width)]);
      if (fails(candidate)) result = candidate;
      else start += width;
    }
  }
  return result;
}

test("counterexample minimizer retains a negative control", () => {
  assert.deepEqual(minimize(bytes("abc!def"), candidate => candidate.includes(33)), bytes("!"));
});

test("seed 0x504446: 512 bounded mutations preserve chunk outcomes and input bytes", () => {
  let state = 0x504446;
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  const roots = ["[1 0 R /A#20 <00ff> (a\\(b)]", "<< /N 1 /N null /A [true false] >>", "(nested(a)\\777)", "9007199254740993", "<0g>"];
  for (let iteration = 0; iteration < 512; iteration++) {
    const input = bytes(roots[next() % roots.length]!);
    for (let count = 1 + next() % 4; count > 0; count--) input[next() % input.length] = next() % 256;
    const snapshot = input.slice();
    const split = next() % (input.length + 1);
    const check = (candidate: Uint8Array) => {
      try {
        assert.deepEqual(syntaxOutcome(candidate), syntaxOutcome([candidate.subarray(0, Math.min(split, candidate.length)), candidate.subarray(Math.min(split, candidate.length))]));
        return false;
      } catch { return true; }
    };
    if (check(input)) {
      const reduced = minimize(input, check);
      assert.fail(`seed=0x504446 iteration=${iteration} split=${split} minimized=${Array.from(reduced, b => b.toString(16).padStart(2, "0")).join("")}`);
    }
    assert.deepEqual(input, snapshot);
  }
});

test("strict malformed controls, quota admission and falsey cancellation remain fatal", () => {
  for (const source of ["--2", "1-2", "+", ".", "-1 0 R", "[", "<< /A", "/#GG", "<0g>"]) {
    assert.throws(() => parsePdfObjects(bytes(source), { limits }), error => error instanceof PdfSyntaxError && error.code === "SYNTAX");
  }
  const input = page("1.7", 0);
  for (const recovery of [false, true]) {
    for (const budget of [{ inputBytes: input.length - 1 }, { work: 0 }, { retainedBytes: 0 }]) {
      assert.throws(() => openPdf(input, { recovery, limits: { ...limits, ...budget } }), error => error instanceof PdfSyntaxError && error.code === "LIMIT");
    }
    for (const reason of [0, false, "cancel", new Error("cancel")]) {
      const controller = new AbortController();
      controller.abort(reason);
      assert.throws(() => openPdf(input, { recovery, signal: controller.signal }), error => error === reason);
    }
  }
  const dictionary = parsePdfObjects(bytes("<< /Filter /RunLengthDecode >>"))[0]!;
  assert.throws(() => decodePdfStream(new Uint8Array([129, 65, 128]), dictionary,
    { limits: { ...limits, expandedBytes: 127 } }), error => error instanceof PdfSyntaxError && error.code === "LIMIT");
});

test("repeated document reads exhaust cumulative retained/work budgets within 64 reads", () => {
  for (const budget of [{ retainedBytes: 4096 }, { work: 4096 }]) {
    const document = openPdf(page("1.7", 0), { limits: { ...limits, objects: 10000, ...budget } });
    let reads = 0;
    assert.throws(() => {
      for (; reads < 64; reads++) document.getObject(3, 0);
    }, error => error instanceof PdfSyntaxError && error.code === "LIMIT");
    assert.ok(reads > 0 && reads < 64, `budget=${JSON.stringify(budget)} reads=${reads}`);
  }
});
