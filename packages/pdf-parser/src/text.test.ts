import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePdfObjects, PdfSyntaxError } from "./syntax.js";
import { interpretPdfText, parseToUnicode } from "./text.js";
const bytes = (s: string) => new TextEncoder().encode(s);
const obj = (s: string) => parsePdfObjects(bytes(s))[0]!;
const font = obj(
  "<< /Subtype /Type1 /Encoding /WinAnsiEncoding /FirstChar 65 /Widths [500 600 700] >>"
);
const resources = obj("<< /Font << /F1 1 0 R >> >>");
const run = (s: string) => interpretPdfText(bytes(s), resources, { lookup: () => font });
test("valid dictionary base encodings do not report unsupported fonts", () => {
  for (const encoding of ["StandardEncoding", "WinAnsiEncoding", "MacRomanEncoding"]) {
    const f = obj(
      `<< /Subtype /Type1 /Encoding << /BaseEncoding /${encoding} /Differences [66 /C] >> /FirstChar 65 /Widths [500 500] >>`
    );
    const r = interpretPdfText(bytes("BT /F1 10 Tf (AB) Tj ET"), resources, { lookup: () => f });
    assert.equal(r.text, "AC");
    assert.deepEqual(r.diagnostics, []);
  }
});
test("Type0 fonts cannot infer Identity encoding when the required Encoding is absent", () => {
  const f = obj(
    "<< /Subtype /Type0 /DescendantFonts [<< /Subtype /CIDFontType2 >>] /ToUnicode 2 0 R >>"
  );
  let streamCalls = 0;
  assert.throws(
    () =>
      interpretPdfText(bytes("BT /F1 10 Tf <0001> Tj ET"), resources, {
        lookup: () => f,
        stream: () => {
          streamCalls++;
          return bytes("1 beginbfchar <0001> <0041> endbfchar");
        }
      }),
    (e) => e instanceof PdfSyntaxError && e.code === "SYNTAX"
  );
  assert.equal(streamCalls, 0);
});
test("embedded format4 cannot reverse glyph IDs from unaligned range offsets", async () => {
  const { embeddedUnicodeCmap } = await import("./font-cmap.js");
  const { SyntaxReader } = await import("./syntax.js");
  const b = new Uint8Array(76),
    v = new DataView(b.buffer);
  v.setUint32(0, 0x10000);
  v.setUint16(4, 1);
  b.set(bytes("cmap"), 12);
  v.setUint32(20, 28);
  v.setUint32(24, 48);
  v.setUint16(30, 1);
  v.setUint16(32, 3);
  v.setUint16(34, 1);
  v.setUint32(36, 12);
  v.setUint16(40, 4);
  v.setUint16(42, 36);
  v.setUint16(46, 4);
  v.setUint16(54, 65);
  v.setUint16(56, 65535);
  v.setUint16(60, 65);
  v.setUint16(62, 65535);
  v.setUint16(66, 1);
  v.setUint16(68, 4);
  v.setUint16(72, 1);
  assert.equal(embeddedUnicodeCmap(b, new SyntaxReader(bytes(""), {}), 10).get(1), "A");
  v.setUint16(68, 5);
  assert.throws(
    () => embeddedUnicodeCmap(b, new SyntaxReader(bytes(""), {}), 10),
    (e) => e instanceof PdfSyntaxError && e.code === "SYNTAX"
  );
});
test("text geometry follows matrices, widths, spacing and TJ source order", () => {
  const result = run(
    "q 2 0 0 2 0 0 cm BT /F1 10 Tf 1 0 0 1 20 30 Tm [(A) -500 (B) 500 (C)] TJ ET Q"
  );
  assert.equal(result.text, "ABC");
  assert.deepEqual(
    result.glyphs.map((g) => g.origin),
    [
      [40, 60],
      [60, 60],
      [62, 60]
    ]
  );
  assert.deepEqual(
    result.glyphs.map((g) => g.rawCode),
    [65, 66, 67]
  );
  assert.equal(result.glyphs[0]!.source.operator, "TJ");
});
test("ToUnicode preserves multi-scalar strings and ligatures without normalization", () => {
  const map = parseToUnicode(
    bytes(
      "1 begincodespacerange <00> <ff> endcodespacerange 3 beginbfchar <01> <0041> <02> <00660069> <03> <d83dde00> endbfchar"
    )
  );
  assert.equal(map.mapping.get("1:1"), "A");
  assert.equal(map.mapping.get("1:2"), "fi");
  assert.equal(map.mapping.get("1:3"), "😀");
  assert.throws(() => parseToUnicode(bytes("1 beginbfchar <01> <d800> endbfchar")), /surrogate/);
  assert.throws(
    () =>
      parseToUnicode(bytes("1 beginbfrange <0000> <ffff> <0041> endbfrange"), { maxMappings: 10 }),
    /limit/
  );
});
test("ActualText replaces a populated span once, retaining glyph provenance", () => {
  const r = run(
    "BT /F1 10 Tf /Span << /ActualText <feff00610063007400750061006c> >> BDC (ABC) Tj EMC ET"
  );
  assert.equal(r.text, "actual");
  assert.equal(r.glyphs.map((g) => g.unicode).join(""), "ABC");
  assert.equal(r.replacements[0]!.glyphEnd, 3);
  assert.equal(run("/Span << /ActualText (empty) >> BDC EMC").text, "");
});
test("unknown Differences glyphs do not invent readable text", () => {
  const f = obj("<< /Subtype /Type1 /Encoding << /Differences [65 /unknown] >> >>");
  const r = interpretPdfText(bytes("BT /F1 12 Tf (A) Tj ET"), resources, { lookup: () => f });
  assert.equal(r.text, "");
  assert.equal(r.diagnostics[0]!.code, "UNKNOWN_GLYPH");
});
test("glyph names cannot resolve inherited JavaScript properties", () => {
  for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
    const f = obj(`<< /Subtype /Type1 /Encoding << /Differences [65 /${name}] >> >>`);
    const r = interpretPdfText(bytes("BT /F1 10 Tf (A) Tj ET"), resources, { lookup: () => f });
    assert.equal(r.text, "");
    assert.equal(r.glyphs[0]!.unicode, undefined);
    assert.ok(r.diagnostics.some((d) => d.code === "UNKNOWN_GLYPH"));
  }
});
test("transformed glyph advances reject overflow even with finite origins", () => {
  const transforms = "1000000000000000 0 0 1 0 0 cm ".repeat(20);
  assert.throws(() => run(`${transforms}BT /F1 1 Tf 1000000000000000 Tc (A) Tj ET`), /overflow/);
});
test("form recursion, state underflow, inline images, cancellation and work quotas are fatal", () => {
  assert.throws(() => run("Q"), /stack/);
  assert.throws(() => run("BI /W 1 ID abc EI"), /inline image/);
  const signal = AbortSignal.abort("stop");
  assert.throws(
    () => interpretPdfText(bytes(""), resources, { signal }),
    (e) => e === "stop"
  );
  assert.throws(
    () =>
      interpretPdfText(bytes("BT /F1 10 Tf (ABC) Tj ET"), resources, {
        lookup: () => font,
        limits: { work: 10 }
      }),
    /limit/
  );
});
test("Type0 Identity mapping uses CID widths and does not fill partial ToUnicode", () => {
  const f = obj(
    "<< /Subtype /Type0 /Encoding /Identity-H /DescendantFonts [<< /Subtype /CIDFontType2 /DW 1000 /W [1 [500 700]] >>] /ToUnicode 2 0 R >>"
  );
  const r = interpretPdfText(bytes("BT /F1 10 Tf <00010002> Tj ET"), resources, {
    lookup: () => f,
    stream: () =>
      bytes(
        "1 begincodespacerange <0000> <ffff> endcodespacerange 1 beginbfchar <0001> <fb01> endbfchar"
      )
  });
  assert.equal(r.text, "ﬁ");
  assert.deepEqual(
    r.glyphs.map((g) => g.origin),
    [
      [0, 0],
      [5, 0]
    ]
  );
  assert.equal(r.glyphs[1]!.unicode, undefined);
});
test("nested ActualText uses explicit outermost-scope replacement; properties resolve", () => {
  assert.equal(
    run(
      "BT /F1 10 Tf /Span << /ActualText (outer) >> BDC (A) Tj /Span << /ActualText (inner) >> BDC (B) Tj EMC (C) Tj EMC ET"
    ).text,
    "outer"
  );
  const res = obj("<< /Font << /F1 1 0 R >> /Properties << /P << /ActualText (named) >> >> >>");
  assert.equal(
    interpretPdfText(bytes("BT /F1 10 Tf /Span /P BDC (A) Tj EMC ET"), res, { lookup: () => font })
      .text,
    "named"
  );
});
test("forms use local resources and restore caller state, cyclic forms are bounded", () => {
  const form = obj(
    "<< /Subtype /Form /Matrix [1 0 0 1 50 0] /Resources << /Font << /F1 1 0 R >> /XObject << /Self 2 0 R >> >> >>"
  );
  const res = obj("<< /Font << /F1 1 0 R >> /XObject << /X 2 0 R >> >>");
  const opts = {
    lookup: (r: ReturnType<typeof obj>) => (r.objectNumber === 1 ? font : form),
    stream: () => bytes("BT /F1 10 Tf (A) Tj ET")
  };
  const r = interpretPdfText(bytes("/X Do BT /F1 10 Tf (B) Tj ET"), res, opts);
  assert.deepEqual(
    r.glyphs.map((g) => g.origin),
    [
      [50, 0],
      [0, 0]
    ]
  );
  assert.equal(r.glyphs[0]!.source.formPath.length, 1);
  assert.throws(
    () => interpretPdfText(bytes("/X Do"), res, { ...opts, stream: () => bytes("/Self Do") }),
    /cycle/
  );
});
test("normalization is opt-in and never rewrites glyph mappings", () => {
  const f = obj("<< /Subtype /Type1 /Encoding << /Differences [65 /uniFB01] >> >>");
  const r = interpretPdfText(bytes("BT /F1 10 Tf (A) Tj ET"), resources, {
    lookup: () => f,
    normalization: "NFKC"
  });
  assert.equal(r.text, "fi");
  assert.equal(r.glyphs[0]!.unicode, "ﬁ");
});
test("embedded TrueType Unicode cmap provides explicit CID-to-glyph fallback", () => {
  const b = new Uint8Array(68);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, 1);
  b.set(bytes("cmap"), 12);
  v.setUint32(20, 28);
  v.setUint32(24, 40);
  v.setUint16(30, 1);
  v.setUint16(32, 3);
  v.setUint16(34, 10);
  v.setUint32(36, 12);
  v.setUint16(40, 12);
  v.setUint32(44, 28);
  v.setUint32(52, 1);
  v.setUint32(56, 0x1f600);
  v.setUint32(60, 0x1f600);
  v.setUint32(64, 1);
  const f = obj(
    "<< /Subtype /Type0 /Encoding /Identity-H /DescendantFonts [<< /Subtype /CIDFontType2 /CIDToGIDMap /Identity /FontDescriptor << /FontFile2 3 0 R >> >>] >>"
  );
  const r = interpretPdfText(bytes("BT /F1 10 Tf <0001> Tj ET"), resources, {
    lookup: () => f,
    stream: () => b
  });
  assert.equal(r.text, "😀");
  assert.equal(r.glyphs[0]!.mapping, "embedded-cmap");
});
test("embedded cmap truncation and expansion limits are fatal", () => {
  const f = obj(
    "<< /Subtype /Type0 /Encoding /Identity-H /DescendantFonts [<< /Subtype /CIDFontType2 /FontDescriptor << /FontFile2 3 0 R >> >>] >>"
  );
  assert.throws(
    () =>
      interpretPdfText(bytes("BT /F1 10 Tf <0001> Tj ET"), resources, {
        lookup: () => f,
        stream: () => new Uint8Array(3)
      }),
    /truncated/
  );
});
test("unsupported base encodings do not masquerade as ASCII", () => {
  const f = obj("<< /Subtype /Type1 /Encoding /Unknown >>");
  const r = interpretPdfText(bytes("BT /F1 10 Tf (A) Tj ET"), resources, { lookup: () => f });
  assert.equal(r.text, "");
  assert.ok(r.diagnostics.some((d) => d.code === "UNSUPPORTED_FONT"));
});
test("vertical CID metrics and TJ adjust along the vertical writing axis", () => {
  const f = obj(
    "<< /Subtype /Type0 /Encoding /Identity-V /DescendantFonts [<< /Subtype /CIDFontType2 /DW 1000 /DW2 [880 -1000] /W2 [1 [-900 500 800]] >>] /ToUnicode 2 0 R >>"
  );
  const r = interpretPdfText(bytes("BT /F1 10 Tf [<0001> 100 <0001>] TJ ET"), resources, {
    lookup: () => f,
    stream: () => bytes("1 beginbfchar <0001> <0041> endbfchar")
  });
  assert.deepEqual(
    r.glyphs.map((g) => g.origin),
    [
      [-5, -8],
      [-5, -18]
    ]
  );
  assert.deepEqual(r.glyphs[0]!.advance, [0, -9]);
});
test("supplied CID encoding CMaps separate character codes from CIDs", () => {
  const f = obj(
    "<< /Subtype /Type0 /Encoding 3 0 R /DescendantFonts [<< /Subtype /CIDFontType2 /W [7 [500]] >>] /ToUnicode 2 0 R >>"
  );
  const r = interpretPdfText(bytes("BT /F1 10 Tf <01> Tj ET"), resources, {
    lookup: (r) => (r.objectNumber === 1 ? f : obj("<< >>")),
    stream: (r) =>
      bytes(
        r.objectNumber === 3
          ? "1 begincodespacerange <00> <ff> endcodespacerange 1 begincidchar <01> 7 endcidchar"
          : "1 beginbfchar <01> <0041> endbfchar"
      )
  });
  assert.equal(r.text, "A");
  assert.equal(r.glyphs[0]!.cid, 7);
  assert.deepEqual(r.glyphs[0]!.advance, [5, 0]);
});
test("Standard and MacRoman base encoding are distinct from WinAnsi", () => {
  const input = bytes("BT /F1 10 Tf <276080> Tj ET");
  const standard = interpretPdfText(input, resources, {
    lookup: () => obj("<< /Subtype /Type1 /Encoding /StandardEncoding >>")
  });
  assert.equal(standard.text, "’‘");
  const mac = interpretPdfText(input, resources, {
    lookup: () => obj("<< /Subtype /TrueType /Encoding /MacRomanEncoding >>")
  });
  assert.equal(mac.text, "'`Ä");
});
test("a CMap ordinary numeric def does not enable vertical mode", () => {
  const map = parseToUnicode(bytes("/CMapType 1 def 1 beginbfchar <01> <0041> endbfchar"));
  assert.equal(map.vertical, false);
});
test("public content tokenizer preserves operands and source offsets", async () => {
  const { tokenizePdfContent } = await import("./text.js");
  const ops = tokenizePdfContent(bytes("% comment\nBT /F1 12 Tf [(A\\)B) -250 <ff>] TJ ET"));
  assert.deepEqual(
    ops.map((o) => o.operator),
    ["BT", "Tf", "TJ", "ET"]
  );
  assert.deepEqual([...ops[2]!.operands[0]!.items![0]!.bytes!], [65, 41, 66]);
  assert.equal(ops[0]!.start, 10);
});
test("document page extraction joins content streams and shares cumulative limits", async () => {
  const { openPdf } = await import("./index.js");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 100 100] >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents [5 0 R 6 0 R] >>",
    "<< /Subtype /Type1 /Encoding /WinAnsiEncoding /FirstChar 65 /Widths [500 600] >>"
  ];
  for (const s of ["BT /F1 10 Tf (A) Tj", "(B) Tj ET"])
    objects.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
  let s = "%PDF-1.7\n";
  const offsets = [0];
  for (const o of objects) {
    offsets.push(s.length);
    s += `${offsets.length - 1} 0 obj\n${o}\nendobj\n`;
  }
  const xref = s.length;
  s += `xref\n0 ${offsets.length}\n0 65535 f\n`;
  for (const o of offsets.slice(1)) s += `${o} 0 n\n`;
  s += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const doc = openPdf(bytes(s), { limits: { retainedBytes: 50000 } });
  const r = doc.extractPageText(0);
  assert.equal(r.text, "AB");
  assert.deepEqual(
    r.glyphs.map((g) => g.origin),
    [
      [0, 0],
      [5, 0]
    ]
  );
  assert.deepEqual(
    r.contentStreams.map((c) => c.reference.objectNumber),
    [5, 6]
  );
  assert.equal(r.glyphs[1]!.source.contentStream?.objectNumber, 6);
  let exhausted = false;
  for (let i = 0; i < 50; i++) {
    try {
      doc.extractPageText(0);
    } catch (e) {
      assert.match(String(e), /limit/);
      exhausted = true;
      break;
    }
  }
  assert.equal(exhausted, true);
});
test("ActualText PDFDocEncoding differs from font encoding and retains bytes", () => {
  const r = run("BT /F1 10 Tf /Span << /ActualText <93a0> >> BDC (A) Tj EMC ET");
  assert.equal(r.text, "ﬁ€");
  assert.deepEqual([...r.replacements[0]!.raw.bytes!], [0x93, 0xa0]);
});
test("malformed UTF8 ActualText reports a parser syntax diagnostic", () => {
  assert.throws(
    () => run("BT /F1 10 Tf /Span << /ActualText <efbbbfff> >> BDC (A) Tj EMC ET"),
    (e) => e instanceof PdfSyntaxError && e.code === "SYNTAX"
  );
});
test("glyph source preserves the complete original encoded string", () => {
  const r = run("BT /F1 10 Tf <4142> Tj ET");
  assert.equal(new TextDecoder().decode(r.glyphs[0]!.source.string.raw!), "<4142>");
});
test("unencoded custom fonts and ligature names do not use compatibility repair", () => {
  const f = obj("<< /Subtype /Type1 /Encoding << /Differences [65 /fi 66 /f_f_i] >> >>");
  const r = interpretPdfText(bytes("BT /F1 10 Tf (AB) Tj ET"), resources, { lookup: () => f });
  assert.equal(r.text, "ﬁffi");
  const custom = interpretPdfText(bytes("BT /F1 10 Tf (A) Tj ET"), resources, {
    lookup: () => obj("<< /Subtype /TrueType >>")
  });
  assert.equal(custom.text, "");
});
test("form text objects must be closed within the form", () => {
  const form = obj("<< /Subtype /Form /Resources << /Font << /F1 1 0 R >> >> >>");
  const res = obj("<< /XObject << /X 2 0 R >> >>");
  assert.throws(
    () =>
      interpretPdfText(bytes("/X Do"), res, {
        lookup: (r) => (r.objectNumber === 1 ? font : form),
        stream: () => bytes("BT /F1 10 Tf (A) Tj")
      }),
    /unclosed BT/
  );
});
test("missing font metrics leave advances and subsequent origins unknown", () => {
  const f = obj("<< /Subtype /Type1 /Encoding /WinAnsiEncoding >>");
  const r = interpretPdfText(bytes("BT /F1 10 Tf (AB) Tj 1 0 0 1 20 30 Tm (C) Tj ET"), resources, {
    lookup: () => f
  });
  assert.equal(r.text, "ABC");
  assert.equal(r.glyphs[0]!.advance, undefined);
  assert.deepEqual(r.glyphs[0]!.origin, [0, 0]);
  assert.equal(r.glyphs[1]!.origin, undefined);
  assert.deepEqual(r.glyphs[2]!.origin, [20, 30]);
  assert.ok(r.diagnostics.some((d) => d.code === "UNKNOWN_WIDTH"));
});
test("ToUnicode retains raw destination and local mapping provenance", () => {
  const map = parseToUnicode(bytes("1 beginbfchar <01> <00660069> endbfchar"));
  assert.deepEqual([...map.sources.get("1:1")!.destination], [0, 102, 0, 105]);
  assert.equal(new TextDecoder().decode(map.sources.get("1:1")!.raw), "<00660069>");
});
test("ExtGState font selection affects text and graphics restoration", () => {
  const res = obj("<< /Font << /F1 1 0 R >> /ExtGState << /GS << /Font [1 0 R 20] >> >> >>");
  const r = interpretPdfText(bytes("BT /F1 10 Tf q /GS gs (A) Tj Q (B) Tj ET"), res, {
    lookup: () => font
  });
  assert.deepEqual(
    r.glyphs.map((g) => g.advance),
    [
      [10, 0],
      [6, 0]
    ]
  );
  assert.deepEqual(
    r.glyphs.map((g) => g.origin),
    [
      [0, 0],
      [10, 0]
    ]
  );
});
test("ToUnicode sequential and array ranges remain bounded and exact", () => {
  const m = parseToUnicode(
    bytes("2 beginbfrange <01> <02> <0041> <03> <04> [<00660069> <d83dde00>] endbfrange")
  );
  assert.deepEqual([...m.mapping.values()], ["A", "B", "fi", "😀"]);
  assert.deepEqual([...m.sources.get("1:2")!.destination], [0, 66]);
  assert.throws(
    () => parseToUnicode(bytes("1 beginbfrange <01> <02> [<0041>] endbfrange")),
    /array length/
  );
  assert.throws(
    () => parseToUnicode(bytes("2 beginbfchar <01> <0041> <01> <0042> endbfchar")),
    /duplicate/
  );
  assert.throws(
    () => parseToUnicode(bytes("2 begincodespacerange <00> <ff> <0000> <ffff> endcodespacerange")),
    /overlapping/
  );
  assert.throws(() => parseToUnicode(bytes("/Other usecmap")), /inheritance/);
});
test("embedded cmap format4 reverses checked glyph IDs and rejects malformed spans", async () => {
  const { embeddedUnicodeCmap } = await import("./font-cmap.js");
  const { SyntaxReader } = await import("./syntax.js");
  const b = new Uint8Array(72),
    v = new DataView(b.buffer);
  v.setUint32(0, 0x10000);
  v.setUint16(4, 1);
  b.set(bytes("cmap"), 12);
  v.setUint32(20, 28);
  v.setUint32(24, 44);
  v.setUint16(30, 1);
  v.setUint16(32, 3);
  v.setUint16(34, 1);
  v.setUint32(36, 12);
  v.setUint16(40, 4);
  v.setUint16(42, 32);
  v.setUint16(46, 4);
  v.setUint16(54, 65);
  v.setUint16(56, 65535);
  v.setUint16(60, 65);
  v.setUint16(62, 65535);
  v.setUint16(64, 65472);
  v.setUint16(66, 1);
  assert.equal(embeddedUnicodeCmap(b, new SyntaxReader(bytes(""), {}), 10).get(1), "A");
  assert.throws(() => embeddedUnicodeCmap(b, new SyntaxReader(bytes(""), {}), 0), /limit/);
  v.setUint16(68, 254);
  assert.throws(() => embeddedUnicodeCmap(b, new SyntaxReader(bytes(""), {}), 10), /glyph span/);
});
test("cancellation triggered by a stream capability propagates its exact reason", () => {
  const controller = new AbortController(),
    reason = { cancel: true };
  const f = obj("<< /Subtype /Type1 /Encoding /WinAnsiEncoding /ToUnicode 2 0 R >>");
  assert.throws(
    () =>
      interpretPdfText(bytes("BT /F1 10 Tf (A) Tj ET"), resources, {
        signal: controller.signal,
        lookup: () => f,
        stream: () => {
          controller.abort(reason);
          return bytes("");
        }
      }),
    (e) => e === reason
  );
});
test("glyph-name grammar is strict and does not use Poppler raw-code repair", () => {
  for (const n of ["uniD83DDE00", "uD800", "u110000", "a65", "uni0041zzzz0042"]) {
    const f = obj(`<< /Subtype /Type1 /Encoding << /Differences [65 /${n}] >> >>`);
    assert.equal(
      interpretPdfText(bytes("BT /F1 10 Tf (A) Tj ET"), resources, { lookup: () => f }).text,
      ""
    );
  }
  assert.throws(
    () =>
      interpretPdfText(bytes("BT /F1 10 Tf (A) Tj ET"), resources, {
        lookup: () => obj("<< /Subtype /Type1 /Encoding << /Differences [-1 /A] >> >>")
      }),
    /Differences index/
  );
});
test("PDF encoding glyph slots differ from host Windows and Mac character sets", () => {
  const win = interpretPdfText(bytes("BT /F1 10 Tf <7f818d8f909da0ad> Tj ET"), resources, {
    lookup: () => obj("<< /Subtype /Type1 /Encoding /WinAnsiEncoding >>")
  });
  assert.equal(win.text, "•••••• -");
  const mac = interpretPdfText(bytes("BT /F1 10 Tf <bdcadb> Tj ET"), resources, {
    lookup: () => obj("<< /Subtype /Type1 /Encoding /MacRomanEncoding >>")
  });
  assert.equal(mac.text, "Ω ¤");
});
test("authoritative ToUnicode does not acquire an unnecessary embedded font program", () => {
  const f = obj(
    "<< /Subtype /Type0 /Encoding /Identity-H /ToUnicode 2 0 R /DescendantFonts [<< /Subtype /CIDFontType2 /FontDescriptor << /FontFile2 3 0 R >> >>] >>"
  );
  const requests: number[] = [];
  const r = interpretPdfText(bytes("BT /F1 10 Tf <0001> Tj ET"), resources, {
    lookup: () => f,
    stream: (ref) => {
      requests.push(ref.objectNumber!);
      if (ref.objectNumber === 3) throw new Error("unnecessary font program");
      return bytes("1 beginbfchar <0001> <0041> endbfchar");
    }
  });
  assert.equal(r.text, "A");
  assert.deepEqual(requests, [2]);
  assert.equal(r.glyphs[0]!.glyphId, 1);
});
test("ToUnicode code spaces cannot change font character boundaries", () => {
  const simple = obj("<< /Subtype /Type1 /Encoding /WinAnsiEncoding /ToUnicode 2 0 R >>");
  const a = interpretPdfText(bytes("BT /F1 10 Tf <4142> Tj ET"), resources, {
    lookup: () => simple,
    stream: () =>
      bytes(
        "1 begincodespacerange <0000> <ffff> endcodespacerange 1 beginbfchar <4142> <0058> endbfchar"
      )
  });
  assert.equal(a.text, "");
  assert.deepEqual(
    a.glyphs.map((g) => g.rawCode),
    [65, 66]
  );
  const cid = obj(
    "<< /Subtype /Type0 /Encoding /Identity-H /DescendantFonts [<< /Subtype /CIDFontType2 >>] /ToUnicode 2 0 R >>"
  );
  const b = interpretPdfText(bytes("BT /F1 10 Tf <0001> Tj ET"), resources, {
    lookup: () => cid,
    stream: () =>
      bytes("1 begincodespacerange <00> <ff> endcodespacerange 1 beginbfchar <01> <0058> endbfchar")
  });
  assert.equal(b.text, "");
  assert.deepEqual(
    b.glyphs.map((g) => g.rawCode),
    [1]
  );
});
