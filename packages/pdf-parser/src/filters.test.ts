import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePdfStream, parsePdfObjects, openPdf } from "./index.js";
const b = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const dict = (s: string) => parsePdfObjects(b(`<< ${s} >>`))[0]!;
const decode = (data: Uint8Array, fields: string, options = {}) =>
  decodePdfStream(data, dict(fields), options).bytes;
const error = (code: string) => (e: unknown) => (e as { code: string }).code === code;
test("ASCII filters, odd hex nibble, whitespace and binary preservation", () => {
  assert.deepEqual(decode(b("00 7f F>"), "/Filter /AHx"), new Uint8Array([0, 127, 240]));
  assert.deepEqual(decode(b("z!!*-'~>"), "/F /A85"), new Uint8Array([0, 0, 0, 0, 0, 1, 2, 3]));
  assert.deepEqual(decode(b("87cURD_*#TDfTZ)+T~>"), "/Filter /ASCII85Decode"), b("Hello, world!"));
  for (const [s, f] of [
    ["0G>", "AHx"],
    ["0", "AHx"],
    ["!~>", "A85"],
    ["!z~>", "A85"],
    ["uuuuu~>", "A85"]
  ])
    assert.throws(() => decode(b(s!), `/Filter /${f}`), error("SYNTAX"));
});
test("RunLength pipeline is ordered, bounded and rejects truncation", () => {
  assert.deepEqual(decode(b("02414243fe4480>"), "/Filter [/AHx /RL] /DP [null null]"), b("ABCDDD"));
  for (const input of [[2, 65], [255], [0, 65]])
    assert.throws(() => decode(new Uint8Array(input), "/Filter /RL"), error("SYNTAX"));
  assert.throws(
    () => decode(new Uint8Array([129, 65, 128]), "/Filter /RL", { limits: { expandedBytes: 127 } }),
    error("LIMIT")
  );
  assert.throws(
    () => decode(b("004180>"), "/Filter [/AHx /RL]", { limits: { expandedBytes: 3 } }),
    error("LIMIT")
  );
});
// Original zlib stored-block fixture: no native or third-party oracle.
const stored = (data: Uint8Array) => {
  let a = 1,
    c = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    c = (c + a) % 65521;
  }
  return new Uint8Array([
    0x78,
    1,
    1,
    data.length & 255,
    data.length >> 8,
    ~data.length & 255,
    (~data.length >> 8) & 255,
    ...data,
    c >> 8,
    c & 255,
    a >> 8,
    a & 255
  ]);
};
test("Flate validates zlib framing, checksum and stored lengths", () => {
  assert.deepEqual(decode(stored(b("abc")), "/Filter /Fl"), b("abc"));
  const bad = stored(b("abc"));
  bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
  assert.throws(() => decode(bad, "/Filter /Fl"), error("SYNTAX"));
  assert.throws(() => decode(stored(b("abc")).subarray(0, 8), "/Filter /Fl"), error("SYNTAX"));
});
test("Flate checksum follows its end marker, independently of trailing raw bytes", () => {
  for (const encoded of [stored(b("abc")), fixed([65, 257, 256], b("AAAA")), dynamic()]) {
    const expected = decode(encoded, "/Filter /Fl");
    for (const suffix of [b("\0endstream\xff"), stored(b("second stream"))]) {
      const input = new Uint8Array([...encoded, ...suffix]);
      const result = decodePdfStream(input, dict("/Filter /Fl"));
      assert.deepEqual(result.bytes, expected);
      assert.deepEqual(result.raw, input);
      const corrupted = input.slice();
      corrupted[encoded.length - 1] = corrupted[encoded.length - 1]! ^ 1;
      assert.throws(() => decode(corrupted, "/Filter /Fl"), error("SYNTAX"));
    }
    for (let missing = 1; missing <= 4; missing++)
      assert.throws(() => decode(encoded.slice(0, -missing), "/Filter /Fl"), error("SYNTAX"));
  }
});
test("TIFF packed samples and PNG row predictors", () => {
  assert.deepEqual(
    decode(stored(new Uint8Array([10, 10, 10])), "/Filter /Fl /DP << /Predictor 2 /Columns 3 >>"),
    new Uint8Array([10, 20, 30])
  );
  assert.deepEqual(
    decode(
      stored(new Uint8Array([0x55])),
      "/Filter /Fl /DP << /Predictor 2 /Columns 4 /BitsPerComponent 2 >>"
    ),
    new Uint8Array([0x6c])
  );
  assert.deepEqual(
    decode(
      stored(new Uint8Array([1, 10, 10, 10, 2, 1, 2, 3])),
      "/Filter /Fl /DP << /Predictor 15 /Columns 3 >>"
    ),
    new Uint8Array([10, 20, 30, 11, 22, 33])
  );
  for (const row of [
    [5, 1],
    [1, 1]
  ])
    assert.throws(
      () => decode(stored(new Uint8Array(row)), "/Filter /Fl /DP << /Predictor 15 /Columns 2 >>"),
      error("SYNTAX")
    );
  assert.throws(
    () =>
      decode(
        stored(b("x")),
        "/Filter /Fl /DP << /Predictor 2 /Columns 9007199254740991 /Colors 4 >>"
      ),
    error("LIMIT")
  );
});
const codes = (values: number[]) => {
  let bits = "";
  for (const v of values) bits += v.toString(2).padStart(9, "0");
  return Uint8Array.from({ length: Math.ceil(bits.length / 8) }, (_, i) =>
    parseInt(bits.slice(i * 8, i * 8 + 8).padEnd(8, "0"), 2)
  );
};
test("LZW clear, KwKwK, end code and EarlyChange validation", () => {
  for (const early of [0, 1])
    assert.deepEqual(
      decode(codes([256, 65, 258, 257]), `/Filter /LZW /DP << /EarlyChange ${early} >>`),
      b("AAA")
    );
  assert.throws(() => decode(codes([256, 259, 257]), "/Filter /LZW"), error("SYNTAX"));
  assert.throws(() => decode(codes([256, 65]), "/Filter /LZW"), error("SYNTAX"));
  assert.throws(
    () => decode(codes([257]), "/Filter /LZW /DP << /EarlyChange 2 >>"),
    error("SYNTAX")
  );
});
test("image gates preserve raw and intermediate bytes; required decoding fails", () => {
  for (const name of ["DCTDecode", "JPXDecode", "JBIG2Decode", "CCITTFaxDecode"]) {
    const input = b("abcd>");
    assert.throws(() => decode(input, `/Filter /${name}`), error("UNSUPPORTED"));
    const result = decodePdfStream(input, dict(`/Filter [/AHx /${name}]`), {
      imageMode: "preserve"
    });
    assert.deepEqual(result.raw, input);
    assert.deepEqual(result.bytes, new Uint8Array([0xab, 0xcd]));
    assert.deepEqual(result.remainingFilters, [name]);
    input.fill(0);
    assert.deepEqual(result.raw, b("abcd>"));
  }
  assert.throws(() => decode(b("abc"), "/Filter /BrotliDecode"), error("UNSUPPORTED"));
});
test("cancellation, work, retained quota and malformed parameters are fatal", () => {
  const controller = new AbortController();
  const reason = { cancel: true };
  controller.abort(reason);
  assert.throws(
    () => decode(b("00>"), "/Filter /AHx", { signal: controller.signal }),
    (e) => e === reason
  );
  assert.throws(() => decode(b("00>"), "/Filter /AHx", { limits: { work: 1 } }), error("LIMIT"));
  assert.throws(
    () => decode(b("00>"), "/Filter /AHx", { limits: { retainedBytes: 0 } }),
    error("LIMIT")
  );
  for (const fields of [
    "/Filter [/AHx] /DP []",
    "/Filter /AHx /DP 2",
    "/Filter [2]",
    "/Filter /Fl /DP << /BitsPerComponent 3 >>"
  ])
    assert.throws(() => decode(stored(b("x")), fields), error("SYNTAX"));
});
test("retained admission rejects input snapshots before copying", (t) => {
  const fields = dict("/Filter /AHx");
  const input = b("00>");
  const copy = t.mock.method(Uint8Array.prototype, "set");
  assert.throws(
    () => decodePdfStream(input, fields, { limits: { retainedBytes: 0 } }),
    error("LIMIT")
  );
  assert.equal(copy.mock.callCount(), 0);
});
// Independent MSB code packer, width schedule explicitly specified by fixture.
function packed(values: { value: number; width: number }[]): Uint8Array {
  let bits = "";
  for (const { value, width } of values) bits += value.toString(2).padStart(width, "0");
  return Uint8Array.from({ length: Math.ceil(bits.length / 8) }, (_, i) =>
    parseInt(bits.slice(i * 8, i * 8 + 8).padEnd(8, "0"), 2)
  );
}
test("LZW EarlyChange crosses 9/10/11/12 bit boundaries and clear resets width", () => {
  for (const early of [0, 1]) {
    const values = [{ value: 256, width: 9 }];
    for (let i = 0; i < 2000; i++) {
      const size = 258 + Math.max(0, i - 1) + early;
      const width = size >= 2048 ? 12 : size >= 1024 ? 11 : size >= 512 ? 10 : 9;
      values.push({ value: i % 256, width });
    }
    values.push({ value: 256, width: 12 }, { value: 65, width: 9 }, { value: 257, width: 9 });
    assert.deepEqual(
      decode(packed(values), `/Filter /LZW /DP << /EarlyChange ${early} >>`),
      Uint8Array.from([...Array.from({ length: 2000 }, (_, i) => i % 256), 65])
    );
  }
});
test("LZW saturated dictionary stays at twelve bits and preserves its last entry", () => {
  for (const early of [0, 1]) {
    const values = [{ value: 256, width: 9 }];
    const expected = Uint8Array.from({ length: 5000 }, (_, i) => i % 256);
    for (let i = 0; i < expected.length; i++) {
      // Explicit transition positions for literal-only fixtures, then saturation.
      const width = i >= 1791 - early ? 12 : i >= 767 - early ? 11 : i >= 255 - early ? 10 : 9;
      values.push({ value: expected[i]!, width });
    }
    values.push({ value: 4095, width: 12 }, { value: 256, width: 12 },
      { value: 66, width: 9 }, { value: 257, width: 9 });
    const fields = `/Filter /LZW /DP << /EarlyChange ${early} >>`;
    const input = packed(values);
    assert.deepEqual(decode(input, fields), new Uint8Array([...expected, 253, 254, 66]));
    assert.throws(() => decode(input.slice(0, -2), fields), error("SYNTAX"));
    assert.throws(() => decode(input, fields, { limits: { expandedBytes: 5002 } }), error("LIMIT"));
  }
});
// RFC 1951 fixed Huffman fixture authoring; only emitted token codes, no compressor.
function fixed(tokens: number[], output: Uint8Array): Uint8Array {
  const bits: number[] = [1, 1, 0];
  for (const token of tokens) {
    const width = token < 144 ? 8 : token < 256 ? 9 : token < 280 ? 7 : 8;
    const code =
      token < 144
        ? token + 48
        : token < 256
          ? token - 144 + 400
          : token < 280
            ? token - 256
            : token - 280 + 192;
    for (let j = width - 1; j >= 0; j--) bits.push((code >> j) & 1);
    if (token >= 257 && token <= 264) bits.push(0, 0, 0, 0, 0); // distance code zero = one byte
  }
  const payload = Uint8Array.from({ length: Math.ceil(bits.length / 8) }, (_, i) =>
    bits.slice(i * 8, i * 8 + 8).reduce((v, b, j) => v + b * 2 ** j, 0)
  );
  return new Uint8Array([0x78, 1, ...payload, ...stored(output).slice(-4)]);
}
test("fixed Huffman, overlapping copies and adversarial expansion", () => {
  assert.deepEqual(decode(fixed([65, 257, 256], b("AAAA")), "/Filter /Fl"), b("AAAA"));
  const expanded = b("A".repeat(1001));
  const fixture = fixed([65, ...new Array<number>(100).fill(264), 256], expanded);
  assert.deepEqual(decode(fixture, "/Filter /Fl"), expanded);
  assert.throws(
    () => decode(fixture, "/Filter /Fl", { limits: { expandedBytes: 1000 } }),
    error("LIMIT")
  );
  assert.throws(() => decode(fixed([257, 256], b("AAA")), "/Filter /Fl"), error("SYNTAX"));
});
test("DecodeParms references/nulls, cancellation from lookup and byte chunks", () => {
  const fields = dict("/Filter 1 0 R /DP [2 0 R null]");
  const lookup = (ref: { objectNumber?: number }) =>
    parsePdfObjects(b(ref.objectNumber === 1 ? "[/Fl /AHx]" : "<< /Predictor 1 >>"))[0]!;
  assert.deepEqual(decodePdfStream(stored(b("41>")), fields, { lookup }).bytes, b("A"));
  const controller = new AbortController(),
    reason = { stop: true };
  assert.throws(
    () =>
      decodePdfStream(b("41>"), dict("/Filter 1 0 R"), {
        signal: controller.signal,
        lookup: () => {
          controller.abort(reason);
          return parsePdfObjects(b("/AHx"))[0]!;
        }
      }),
    (e) => e === reason
  );
  for (let i = 0; i <= 5; i++)
    assert.deepEqual(
      decodePdfStream([b("4142>").slice(0, i), b("4142>").slice(i)], dict("/Filter /AHx")).bytes,
      b("AB")
    );
});
function streamPdf(fields: string, payload: string): Uint8Array {
  const head = `%PDF-1.7\n1 0 obj\n<< /Length ${payload.length} ${fields} >>\nstream\n${payload}\nendstream\nendobj\n`;
  return b(
    head + `xref\n0 2\n0 65535 f\n9 0 n\ntrailer\n<< /Size 2 >>\nstartxref\n${head.length}\n%%EOF\n`
  );
}
test("document decoding shares expanded quotas across reads without altering raw streams", () => {
  const doc = openPdf(streamPdf("/Filter /AHx", "4142>"), { limits: { expandedBytes: 3 } });
  assert.deepEqual(doc.decodeStream(1).bytes, b("AB"));
  assert.deepEqual(doc.getObject(1).stream, b("4142>"));
  assert.throws(() => doc.decodeStream(1), error("LIMIT"));
  assert.throws(
    () => openPdf(streamPdf("/Filter /JPXDecode", "raw")).decodeStream(1),
    error("UNSUPPORTED")
  );
  assert.deepEqual(
    openPdf(streamPdf("/Filter /JPXDecode", "raw")).decodeStream(1, 0, { imageMode: "preserve" })
      .remainingFilters,
    ["JPXDecode"]
  );
});
// Complete dynamic tree: symbols A and EOB length 1. Code-length tree has
// symbols 0/1 length 2 and 18 length 1, with repeated zero-length ranges.
function dynamic(distanceCount = 1): Uint8Array {
  const bits: number[] = [1, 0, 1];
  const little = (value: number, width: number) => {
    for (let j = 0; j < width; j++) bits.push((value >> j) & 1);
  };
  little(0, 5);
  little(distanceCount - 1, 5);
  little(14, 4);
  for (const length of [0, 0, 1, 2, ...new Array<number>(13).fill(0), 2]) little(length, 3);
  const repeat = (n: number) => {
    bits.push(0);
    little(n - 11, 7);
  };
  repeat(65);
  bits.push(1, 1);
  repeat(138);
  repeat(52);
  bits.push(1, 1);
  if (distanceCount >= 11) repeat(distanceCount);
  else for (let i = 0; i < distanceCount; i++) bits.push(1, 0);
  bits.push(0, 1); // A then EOB
  const payload = Uint8Array.from({ length: Math.ceil(bits.length / 8) }, (_, i) =>
    bits.slice(i * 8, i * 8 + 8).reduce((v, b, j) => v + b * 2 ** j, 0)
  );
  return new Uint8Array([0x78, 1, ...payload, ...stored(b("A")).slice(-4)]);
}
test("dynamic Huffman repeat ranges and empty distance tree", () => {
  assert.deepEqual(decode(dynamic(), "/Filter /Fl"), b("A"));
  for (const count of [30, 31, 32])
    assert.deepEqual(decode(dynamic(count), "/Filter /Fl"), b("A"));
  const bad = dynamic();
  bad[3] = 255;
  assert.throws(() => decode(bad, "/Filter /Fl"), error("SYNTAX"));
});
test("PNG None/Average/Paeth and TIFF 16-bit multicolor samples", () => {
  assert.deepEqual(
    decode(
      stored(new Uint8Array([0, 10, 20, 30, 3, 6, 7, 8, 4, 1, 2, 3])),
      "/Filter /Fl /DP << /Predictor 15 /Columns 3 >>"
    ),
    new Uint8Array([10, 20, 30, 11, 22, 34, 12, 24, 37])
  );
  assert.deepEqual(
    decode(
      stored(new Uint8Array([0, 255, 1, 0, 0, 1, 255, 255])),
      "/Filter /Fl /DP << /Predictor 2 /Columns 2 /Colors 2 /BitsPerComponent 16 >>"
    ),
    new Uint8Array([0, 255, 1, 0, 1, 0, 0, 255])
  );
});
test("encrypted document streams cannot be presented as decoded bytes", () => {
  const source = streamPdf("", "ciphertext");
  const encrypted = b(String.fromCharCode(...source).replace("/Size 2", "/Size 2 /Encrypt << >>"));
  const doc = openPdf(encrypted);
  assert.deepEqual(doc.getObject(1).stream, b("ciphertext"));
  assert.throws(() => doc.decodeStream(1), error("UNSUPPORTED"));
});
test("predictor shape errors, overflow, reference cycles and explicit image modes", () => {
  for (const fields of [
    "/Predictor 3",
    "/Columns 0",
    "/Colors -1",
    "/Columns 1.0",
    "/BitsPerComponent 0"
  ])
    assert.throws(() => decode(stored(b("x")), `/Filter /Fl /DP << ${fields} >>`), error("SYNTAX"));
  assert.throws(
    () =>
      decodePdfStream(b("00>"), dict("/Filter 1 0 R"), {
        lookup: () => parsePdfObjects(b("1 0 R"))[0]!
      }),
    error("REFERENCE")
  );
  assert.throws(
    () => decodePdfStream(b("raw"), dict("/Filter /DCT"), { imageMode: "bad" as "reject" }),
    error("ARGUMENT")
  );
});
test("Crypt defaults to Identity; other crypt filters require the encryption gate", () => {
  for (const fields of ["/Filter /Crypt", "/Filter /Crypt /DP << /Name /Identity >>"])
    assert.deepEqual(decode(b("binary\0"), fields), b("binary\0"));
  assert.throws(
    () => decode(b("binary"), "/Filter /Crypt /DP << /Name /StdCF >>"),
    error("UNSUPPORTED")
  );
});
test("mid-decode cancellation propagates unchanged in every decoder", () => {
  for (const [input, fields] of [
    [b("00".repeat(2000) + ">"), "/Filter /AHx"],
    [b("z".repeat(2000) + "~>"), "/Filter /A85"],
    [new Uint8Array([129, 65, 128]), "/Filter /RL"],
    [stored(b("A".repeat(2000))), "/Filter /Fl"],
    [codes([256, ...new Array<number>(200).fill(65), 257]), "/Filter /LZW"]
  ] as const) {
    let checks = 0;
    const reason = { midDecode: fields };
    const signal = {
      get aborted() {
        return ++checks > input.length + 100;
      },
      reason
    } as AbortSignal;
    assert.throws(
      () => decode(input, fields, { signal }),
      (e) => e === reason
    );
  }
});
test("filter reference bookkeeping consumes retained allocation quota", () => {
  let calls = 0;
  const reference = parsePdfObjects(b("1 0 R"))[0]!;
  assert.throws(
    () =>
      decodePdfStream(b("00>"), dict("/Filter 1 0 R"), {
        limits: { retainedBytes: 600 },
        lookup: () => ({ ...reference, objectNumber: ++calls + 1 })
      }),
    error("LIMIT")
  );
  assert.ok(calls < 10);
});
test("recovery inspection does not admit decoding without the revision security context", () => {
  const doc = openPdf(
    b("%PDF-1.7\n1 0 obj\n<< /Length 3 /Filter /AHx >>\nstream\n41>\nendstream\nendobj\n"),
    { recovery: true }
  );
  assert.deepEqual(doc.getObject(1).stream, b("41>"));
  assert.throws(() => doc.decodeStream(1), error("UNSUPPORTED"));
});
test("document cancellation takes precedence over unqualified decoding gates", () => {
  for (const recovery of [false, true]) {
    const controller = new AbortController();
    const reason = { cancelled: recovery };
    const input = recovery
      ? b("%PDF-1.7\n1 0 obj\n<< /Length 3 >>\nstream\nraw\nendstream\nendobj\n")
      : b(String.fromCharCode(...streamPdf("", "raw")).replace("/Size 2", "/Size 2 /Encrypt << >>"));
    const doc = openPdf(input, { recovery, signal: controller.signal });
    controller.abort(reason);
    assert.throws(() => doc.decodeStream(1), (e) => e === reason);
  }
});
test("TIFF one/four-bit samples and predictors after LZW", () => {
  assert.deepEqual(
    decode(
      stored(new Uint8Array([0xb0])),
      "/Filter /Fl /DP << /Predictor 2 /Columns 4 /BitsPerComponent 1 >>"
    ),
    new Uint8Array([0xd0])
  );
  assert.deepEqual(
    decode(
      stored(new Uint8Array([0x12, 0x34])),
      "/Filter /Fl /DP << /Predictor 2 /Columns 4 /BitsPerComponent 4 >>"
    ),
    new Uint8Array([0x13, 0x6a])
  );
  assert.deepEqual(
    decode(codes([256, 10, 10, 10, 257]), "/Filter /LZW /DP << /Predictor 2 /Columns 3 >>"),
    new Uint8Array([10, 20, 30])
  );
});
test("Flate all fixed literal ranges and stored block chains", () => {
  const output = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.deepEqual(decode(fixed([...output, 256], output), "/Filter /Fl"), output);
  const first = stored(b("ABC")).slice(2, -4);
  first[0] = 0;
  const second = stored(b("DEF")).slice(2, -4);
  assert.deepEqual(
    decode(
      new Uint8Array([0x78, 1, ...first, ...second, ...stored(b("ABCDEF")).slice(-4)]),
      "/Filter /Fl"
    ),
    b("ABCDEF")
  );
});
