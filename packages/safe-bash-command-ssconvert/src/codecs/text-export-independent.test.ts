import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, SsconvertError, type CapabilityContext, type Workbook } from "../index.js";
import { encodeText } from "../encoding/encode.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100 },
  own() {}
};

it.each(["UCS-2", "UCS-2LE", "UCS-2BE"])("escapes non-BMP characters before encoding %s", charset => {
  const expected = "é\\U0001f600\n";
  const bytes: number[] = [];
  for (const c of expected) {
    const code = c.charCodeAt(0);
    bytes.push(...(charset.endsWith("BE") ? [code >> 8, code & 255] : [code & 255, code >> 8]));
  }
  expect(encodeText("é😀\n", charset, false, context)).toEqual(new Uint8Array(bytes));
});

it("uses the pinned C-locale replacement for non-BMP UCS-2 transliteration", () => {
  expect(encodeText("😀\n", "UCS-2", true, context)).toEqual(new Uint8Array([63, 0, 10, 0]));
});

it.each([
  ["UTF-16", [255, 254, 61, 216, 0, 222, 10, 0]],
  ["UTF-16LE", [61, 216, 0, 222, 10, 0]],
  ["UTF-16BE", [216, 61, 222, 0, 0, 10]],
  ["UTF-32", [255, 254, 0, 0, 0, 246, 1, 0, 10, 0, 0, 0]],
  ["UTF-32BE", [0, 1, 246, 0, 0, 0, 0, 10]]
] as const)("preserves measured BOM and scalar bytes for %s", (charset, bytes) => {
  expect(encodeText("😀\n", charset, false, context)).toEqual(new Uint8Array(bytes));
});

it("uses native UCS-4 network byte ordering without a BOM", () => {
  expect(encodeText("😀\n", "UCS-4", false, context))
    .toEqual(new Uint8Array([0, 1, 246, 0, 0, 0, 0, 10]));
});

it.each(["windows-1250", "windows-1251", "windows-1253", "windows-1254", "windows-1255", "windows-1257", "windows-1258"])
  ("rejects undefined native control bytes in %s", charset => {
    const character = charset === "windows-1251" ? "\u0098" : "\u0081";
    const escaped = charset === "windows-1251" ? "\\u0098" : "\\u0081";
    expect(new TextDecoder().decode(encodeText(character, charset, false, context))).toBe(escaped);
    expect(encodeText(character, charset, true, context)).toEqual(new Uint8Array([63]));
  });

it("preserves the Windows-1252 final byte despite ICU's empty decoder result", () => {
  expect(encodeText("ÿ", "windows-1252", false, context)).toEqual(new Uint8Array([255]));
});

it("escapes the undefined Windows-1253 ordinal indicator", () => {
  expect(new TextDecoder().decode(encodeText("ª", "windows-1253", false, context))).toBe("\\u00aa");
});

it("distinguishes ISO-8859-9 from Windows-1254", () => {
  expect(encodeText("\u0080€İ", "ISO-8859-9", false, context))
    .toEqual(new Uint8Array([128, ...new TextEncoder().encode("\\u20ac"), 221]));
  expect(encodeText("€İ", "windows-1254", false, context)).toEqual(new Uint8Array([128, 221]));
});

it("preserves native Macintosh delta and undefined Apple private-use handling", () => {
  expect(encodeText("Δ∆", "macintosh", false, context))
    .toEqual(new Uint8Array([198, ...new TextEncoder().encode("\\u2206\\uf8ff")]));
});

it("matches measured C-locale ligatures, fractions and typography transliteration", () => {
  expect(new TextDecoder().decode(encodeText("ßÆæŒœµ×¼½¾«»‚„†ˆ˜‹›•\u00ad¸", "ASCII", true, context)))
    .toBe("ssAEaeOEoeux 1/4  1/2  3/4 <<>>,,,+^~<>o-,");
});

it("encodes measured ISO-8859-16 extended letters and currency bytes", () => {
  expect(encodeText("\u0080Ą€ȘȚÿ", "ISO-8859-16", false, context))
    .toEqual(new Uint8Array([128, 161, 164, 170, 222, 255]));
});

it("uses the pinned C locale's ASCII converter for an empty charset", () => {
  expect(new TextDecoder().decode(encodeText("é€😀", "", false, context)))
    .toBe("\\u00e9\\u20ac\\U0001f600");
});

it.each(["UTF-7", "UTF7", "UTF-7-IMAP", "ISO-2022-CN", "EBCDIC-US", "JOHAB", "CSISO4UNITEDKINGDOM"])
  ("reports valid but unimplemented native charset %s as unsupported", charset => {
    expect(() => encodeText("é", charset, false, context)).toThrow(SsconvertError);
    expect(() => encodeText("é", charset, false, context)).toThrow("uncaptured export charset");
  });

it.each(["CP437", "437", "CSPC8CODEPAGE437"])("encodes measured DOS alias %s", charset => {
  expect(encodeText("é", charset, false, context)).toEqual(new Uint8Array([130]));
});

it("encodes the measured LATIN10 alias", () => {
  expect(encodeText("Ș", "LATIN10", false, context)).toEqual(new Uint8Array([170]));
});

it.each([["UCS2", "UCS-2"], ["UCS4", "UCS-4"], ["UTF16", "UTF-16"], ["UTF32", "UTF-32"]])
  ("preserves the measured %s charset alias", (alias, canonical) => {
    expect(encodeText("é😀", alias, false, context)).toEqual(encodeText("é😀", canonical, false, context));
  });

it("preserves ASCII escaping and the pinned C-locale transliteration expansions", () => {
  expect(new TextDecoder().decode(encodeText("é € 漢 😀", "ASCII", false, context)))
    .toBe("\\u00e9 \\u20ac \\u6f22 \\U0001f600");
  expect(new TextDecoder().decode(encodeText("é € 漢 😀", "ASCII", true, context))).toBe("? EUR ? ?");
  expect(encodeText("é €", "CP1252", false, context)).toEqual(new Uint8Array([233, 32, 128]));
});

it("observes cancellation identity and encoded byte expansion limits", () => {
  const controller = new AbortController(), reason = { cancelled: true };
  controller.abort(reason);
  expect(() => encodeText("text", "UTF-16", false, { ...context, signal: controller.signal })).toThrow(reason);
  for (const charset of ["UTF-8", "UTF-16", "UTF-32", "ASCII"])
    expect(() => encodeText("😀", charset, false, { ...context,
      limits: { ...context.limits, outputBytes: 3 } })).toThrow("ssconvert output bytes limit exceeded");
});

it("shares CLI and SDK byte encoding with in-memory publication", async () => {
  const volume = Volume.fromJSON({ "/input": "fixture", "/output": "keep" });
  const book: Workbook = { sheets: [{ id: "a", name: "A", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "😀" } }
  ] }] };
  const engine = createEngine({
    codecs: [{ id: "fixture", description: "Original in-memory fixture", extensions: [],
      probeContent: () => true, async read() { return book; } }],
    environment: context.environment, limits: context.limits,
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); } }
  });
  const errors: Uint8Array[] = [];
  const operation = { signal: context.signal, stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(new Uint8Array(bytes)); } } };
  try {
    const result = await runCommand(["-T", "Gnumeric_stf:stf_assistant", "-O",
      "charset=UCS-2 transliterate-mode=escape", "/input", "/output"], engine, operation);
    expect(result.exitCode).toBe(0);
    expect(errors).toEqual([]);
    const cliBytes = new Uint8Array(volume.readFileSync("/output") as Uint8Array);
    const chunks: Uint8Array[] = [];
    const ownedBook = await engine.readWorkbook({ kind: "resource", uri: "/input" }, {}, operation);
    const sdk = await engine.writeWorkbook(ownedBook, { kind: "stream", sink: {
      async write(bytes) { chunks.push(new Uint8Array(bytes)); }
    } }, { exportType: "Gnumeric_stf:stf_assistant",
      exportOptions: ["charset=UCS-2 transliterate-mode=escape"] }, operation);
    expect(sdk.exitCode).toBe(0);
    expect(chunks).toEqual([cliBytes]);
    expect(cliBytes).toEqual(encodeText("\\U0001f600\n", "UCS-2", false, context));
  } finally { await engine.dispose(); }
});
