import { test } from "node:test";
import assert from "node:assert/strict";
import { openPdf } from "./revisions.js";
import { PdfSyntaxError } from "./syntax.js";
const b = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
function classic(value = "(old)") {
  const head = `%PDF-1.7\n1 0 obj\n${value}\nendobj\n`;
  const offset = head.length;
  return {
    offset,
    source:
      head +
      `xref\n0 2\n0000000000 65535 f\n0000000009 00000 n\ntrailer\n<< /Size 2 >>\nstartxref\n${offset}\n%%EOF\n`
  };
}
test("classic newest revision wins, free entries mask history and generations match", () => {
  const old = classic();
  assert.equal(openPdf(b(old.source)).getObject(1, 0).object.kind, "string");
  const prefix = old.source + "1 1 obj\n(new)\nendobj\n";
  const next =
    prefix +
    `xref\n1 1\n${old.source.length} 1 n\ntrailer\n<< /Size 2 /Prev ${old.offset} >>\nstartxref\n${prefix.length}\n%%EOF\n`;
  const doc = openPdf(b(next));
  assert.deepEqual(doc.getObject(1, 1).object.bytes, b("new"));
  assert.throws(() => doc.getObject(1, 0), /generation/);
  assert.equal(doc.revisions.length, 2);
  const free =
    old.source +
    `xref\n1 1\n0 1 f\ntrailer\n<< /Size 2 /Prev ${old.offset} >>\nstartxref\n${old.source.length}\n%%EOF\n`;
  assert.throws(() => openPdf(b(free)).getObject(1, 0), /free/);
});
test("xref streams and compressed objects use checked fields and zero width defaults", () => {
  const head =
    "%PDF-2.0\n1 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Length 9 >>\nstream\n2 0 (yes)\nendstream\nendobj\n";
  const raw = String.fromCharCode(0, 0, 255, 1, 9, 0, 2, 1, 0, 1, head.length, 0);
  const source =
    head +
    `3 0 obj\n<< /Type /XRef /Size 4 /W [1 1 1] /Length 12 >>\nstream\n${raw}\nendstream\nendobj\nstartxref\n${head.length}\n%%EOF\n`;
  const doc = openPdf(b(source));
  assert.deepEqual(doc.getObject(2, 0).object.bytes, b("yes"));
  assert.throws(() => doc.getObject(2, 1), /generation/);
  const single = "%PDF-1.5\n";
  const x =
    single +
    `1 0 obj\n<< /Type /XRef /Size 2 /Index [1 1] /W [0 1 0] /Length 1 >>\nstream\n${String.fromCharCode(9)}\nendstream\nendobj\nstartxref\n9\n%%EOF\n`;
  assert.equal(openPdf(b(x)).getObject(1, 0).object.kind, "dictionary");
});
test("stream boundaries, indirect Length and reference cycles are strict", () => {
  const head = "%PDF-1.7\n1 0 obj\n<< /Length 2 0 R >>\nstream\naendstreamb\nendstream\nendobj\n";
  const lengthOffset = head.length;
  const prefix = head + "2 0 obj\n11\nendobj\n";
  const source =
    prefix +
    `xref\n0 3\n0 65535 f\n9 0 n\n${lengthOffset} 0 n\ntrailer\n<< /Size 3 >>\nstartxref\n${prefix.length}\n%%EOF\n`;
  assert.deepEqual(openPdf(b(source)).getObject(1, 0).stream, b("aendstreamb"));
  assert.throws(() => openPdf(b(source.replace("\n11\n", "\n10\n"))).getObject(1, 0), /endstream/);
  assert.throws(() => openPdf(b(classic("1 0 R").source)).resolve(1, 0), /cycle/);
});
test("cycles, truncation, overflow, unsupported filters, quotas and cancellation are fatal", () => {
  const old = classic();
  const cycle = old.source.replace("/Size 2", `/Size 2 /Prev ${old.offset}`);
  assert.throws(() => openPdf(b(cycle)), /cycle/);
  assert.throws(() => openPdf(b(old.source.slice(0, -8))), /EOF/);
  assert.throws(
    () => openPdf(b(old.source.replace("0000000009", "9007199254740992"))),
    /range|offset/
  );
  assert.throws(() => openPdf(b(old.source), { limits: { work: 1 } }), /limit/);
  const controller = new AbortController();
  const reason = new Error("stop");
  controller.abort(reason);
  assert.throws(
    () => openPdf(b(old.source), { signal: controller.signal }),
    (e) => e === reason
  );
});
test("recovery is explicit, bounded and diagnosed", () => {
  const source = b("%PDF-1.7\n1 0 obj\n(yes)\nendobj\n");
  assert.throws(() => openPdf(source), /EOF|startxref/);
  const doc = openPdf(source, { recovery: true });
  assert.deepEqual(doc.getObject(1, 0).object.bytes, b("yes"));
  assert.equal(doc.diagnostics[0]?.code, "RECOVERY_SCAN");
  assert.throws(() => openPdf(source, { recovery: true, limits: { work: 1 } }), /limit/);
});
test("hybrid stream overrides same-revision free placeholder, not newer revisions", () => {
  const head = "%PDF-1.7\n1 0 obj\n(hybrid)\nendobj\n";
  const streamOffset = head.length;
  const raw = String.fromCharCode(1, 9, 0);
  const prefix =
    head +
    `2 0 obj\n<< /Type /XRef /Size 3 /Index [1 1] /W [1 1 1] /Length 3 >>\nstream\n${raw}\nendstream\nendobj\n`;
  const source =
    prefix +
    `xref\n0 3\n0 65535 f\n0 0 f\n${streamOffset} 0 n\ntrailer\n<< /Size 3 /XRefStm ${streamOffset} >>\nstartxref\n${prefix.length}\n%%EOF\n`;
  assert.deepEqual(openPdf(b(source)).getObject(1, 0).object.bytes, b("hybrid"));
  const newer =
    source +
    `xref\n1 1\n0 1 f\ntrailer\n<< /Size 3 /Prev ${prefix.length} >>\nstartxref\n${source.length}\n%%EOF\n`;
  assert.throws(() => openPdf(b(newer)).getObject(1, 0), /free/);
  assert.throws(
    () => openPdf(b(source.replace(`/XRefStm ${streamOffset}`, `/XRefStm ${prefix.length}`))),
    /cycle/
  );
});
test("structural stream failures and unsupported decoding cannot silently pass", () => {
  const head = "%PDF-1.5\n";
  const make = (dict: string, raw: string) =>
    b(
      head +
        `1 0 obj\n<< /Type /XRef /Size 2 /Index [1 1] ${dict} /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\nstartxref\n9\n%%EOF\n`
    );
  assert.throws(
    () => openPdf(make("/W [0 1 0] /Filter /FlateDecode", String.fromCharCode(9))),
    /unsupported filter/
  );
  assert.throws(
    () =>
      openPdf(make("/W [1 8 0]", String.fromCharCode(1, 255, 255, 255, 255, 255, 255, 255, 255))),
    /overflow/
  );
  assert.throws(() => openPdf(make("/W [0 2 0]", String.fromCharCode(9))), /length/);
  assert.throws(() => openPdf(make("/W [0 1 0]", String.fromCharCode(9, 0))), /length/);
});
test("document byte chunks, ownership, input headers and bounded repeated reads", () => {
  const source = b(classic().source);
  for (let i = 0; i <= source.length; i++)
    assert.deepEqual(
      openPdf([source.subarray(0, i), source.subarray(i)]).getObject(1, 0).object.bytes,
      b("old")
    );
  const doc = openPdf(source);
  source.fill(0);
  const result = doc.getObject(1, 0);
  result.object.bytes!.fill(0);
  assert.deepEqual(doc.getObject(1, 0).object.bytes, b("old"));
  assert.throws(() => openPdf(b(classic().source.replace("%PDF-1.7", "garbage!"))), /header/);
  const bounded = openPdf(b(classic().source), { limits: { retainedBytes: 2000 } });
  assert.throws(() => {
    for (let i = 0; i < 100; i++) bounded.getObject(1, 0);
  }, /limit/);
});
test("table entries must fit their trailer Size", () => {
  assert.throws(() => openPdf(b(classic().source.replace("/Size 2", "/Size 1"))), /Size/);
});
test("recovery preserves syntax-shaped cancellation reasons during parsing", () => {
  for (const source of [classic().source, "%PDF-1.7\n1 0 obj\n(yes)\nendobj\n"]) {
    const controller = new AbortController();
    const reason = new PdfSyntaxError("SYNTAX", "cancelled", 0);
    const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
    let checks = 0;
    Object.defineProperty(controller.signal, "aborted", {
      get() {
        if (++checks === 30) controller.abort(reason);
        return aborted.call(controller.signal);
      }
    });
    assert.throws(
      () => openPdf(b(source), { recovery: true, signal: controller.signal }),
      (error) => error === reason
    );
  }
});
test("xref dictionary lookups avoid temporary byte arrays", () => {
  const source = b(
    `%PDF-1.5\n1 0 obj\n<< /${"a".repeat(10000)} null /Type /XRef /Size 2 /Index [1 1] /W [0 1 0] /Length 1 >>\nstream\n${String.fromCharCode(9)}\nendstream\nendobj\nstartxref\n9\n%%EOF\n`
  );
  const from = Array.from;
  let copies = 0;
  Array.from = ((...args: Parameters<typeof Array.from>) => {
    copies++;
    return from(...args);
  }) as typeof Array.from;
  try {
    assert.equal(openPdf(source).getObject(1).object.kind, "dictionary");
    assert.equal(copies, 0);
  } finally {
    Array.from = from;
  }
});
test("xref stream indirect lengths bootstrap without scanning and validate revision-local values", () => {
  const head = "%PDF-1.5\n1 0 obj\n12   \nendobj\n";
  const xref = head.length;
  const raw = String.fromCharCode(0, 0, 255, 1, 9, 0, 1, xref, 0, 0, 0, 0);
  const original =
    head +
    `2 0 obj\n<< /Type /XRef /Size 4 /W [1 1 1] /Length 1 0 R >>\nstream\n${raw}\nendstream\nendobj\nstartxref\n${xref}\n%%EOF\n`;
  const doc = openPdf(b(original));
  assert.equal(doc.getObject(1).object.value, 12);
  assert.equal(doc.getObject(2).stream?.length, 12);
  // The newer value must not change the length of the older xref stream.
  const prefix = original + "1 1 obj\n99\nendobj\n";
  const updated =
    prefix +
    `xref\n1 1\n${original.length} 1 n\ntrailer\n<< /Size 4 /Prev ${xref} >>\nstartxref\n${prefix.length}\n%%EOF\n`;
  assert.equal(openPdf(b(updated)).getObject(1, 1).object.value, 99);
  assert.throws(() => openPdf(b(original.replace("\n12   \n", "\n13   \n"))), /length/i);
  assert.throws(() => openPdf(b(original.replace("\n12   \n", "\n1 0 R\n"))), /cycle/);
  assert.throws(() => openPdf(b(original.replace("/Length 1 0 R", "/Length 1 1 R"))), /generation/);
  assert.throws(() => openPdf(b(original), { limits: { objects: 2 } }), /limit|range/);
  assert.throws(() => openPdf(b(original), { limits: { retainedBytes: 300 } }), /limit/);
  assert.throws(
    () => openPdf(b(original.replace("/Size 4", "/Size 9007199254740991"))),
    /range|length/
  );
  assert.throws(() => openPdf(b(original.replace("/W [1 1 1]", "/W [0 0 0]"))), /width/);
  for (let i = 0; i <= original.length; i++) {
    const input = b(original);
    assert.equal(openPdf([input.subarray(0, i), input.subarray(i)]).getObject(1).object.value, 12);
  }
});
test("object stream header and member negative controls reject malformed original fixtures", () => {
  function fixture(payload: string, first: number, count: number, memberIndex = 0) {
    const prefix = `%PDF-1.5\n1 0 obj\n<< /Type /ObjStm /N ${count} /First ${first} /Length ${payload.length} >>\nstream\n${payload}\nendstream\nendobj\n`;
    const raw = String.fromCharCode(1, 9, 0, 2, 1, memberIndex);
    return b(
      prefix +
        `3 0 obj\n<< /Type /XRef /Size 4 /Index [1 2] /W [1 1 1] /Length 6 >>\nstream\n${raw}\nendstream\nendobj\nstartxref\n${prefix.length}\n%%EOF\n`
    );
  }
  assert.deepEqual(openPdf(fixture("2 0 (ok)", 4, 1)).getObject(2).object.bytes, b("ok"));
  for (const [payload, first, count, index, error] of [
    ["2 0 (ok)", 4, 1, 1, /index bounds/],
    ["4 0 (ok)", 4, 1, 0, /index mismatch/],
    ["2 0 (ok)", 2, 1, 0, /overlaps header/],
    ["2 0 2 5 (ok) (no)", 8, 2, 0, /header/],
    ["2 5 4 0 (ok) (no)", 8, 2, 0, /header/],
    ["2 0 (ok) (extra)", 4, 1, 0, /compressed object/],
    ["2 0 2 0 R", 4, 1, 0, /compressed object/],
    ["2 0 (ok)", 4, 9007199254740991, 0, /range/]
  ] as const) {
    assert.throws(() => openPdf(fixture(payload, first, count, index)).getObject(2), error);
  }
  const doc = openPdf(fixture("2 0 (ok)", 4, 1));
  assert.throws(() => doc.getObject(2, 1), /generation/);
  assert.deepEqual(doc.getObject(2).object.bytes, b("ok"));
});
