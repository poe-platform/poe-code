import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { openRetainedXml, type XmlRange } from "./retained-xml.js";
const encode = (text: string) => new TextEncoder().encode(text);

it("stores long XML scalars in caller storage and scans without whole-value strings", async () => {
  const fs = createMemoryFileSystem();
  const open = fs.open!.bind(fs);
  let written = 0, outstanding = 0, peak = 0, closed = 0;
  fs.readFile = async () => { throw new Error("whole-file read forbidden"); };
  fs.writeFile = async () => { throw new Error("whole-file write forbidden"); };
  fs.open = async (...args) => {
    const descriptor = await open(...args);
    return new Proxy(descriptor, { get(target, key) {
      if (key === "write") return async (...parameters: Parameters<typeof descriptor.write>) => {
        outstanding += parameters[0].length; peak = Math.max(peak, outstanding);
        try { written += parameters[0].length; return await descriptor.write(...parameters); }
        finally { outstanding -= parameters[0].length; }
      };
      if (key === "close") return async (...parameters: Parameters<typeof descriptor.close>) => { closed++; await descriptor.close(...parameters); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  const source = (async function* () {
    yield encode('<a value="');
    const chunk = new Uint8Array(16384);
    for (let n = 0; n < 80; n++) { chunk.fill(120); yield chunk; }
    yield encode('">');
    for (let n = 0; n < 80; n++) { chunk.fill(121); yield chunk; }
    yield encode('</a>');
  })();
  const xml = await openRetainedXml(source, { workingStorage: { fs, directory: "/", cacheBytes: 16384 } });
  expect(xml.bom).toBe(false);
  const kinds: string[] = [];
  for await (const token of xml.tokens()) {
    kinds.push(token.kind);
    if (token.kind === "attribute-value" || token.kind === "text") {
      expect(token.range.length).toBe(80 * 16384);
      let bytes = 0;
      for await (const chunk of xml.read(token.range)) {
        expect(chunk.length).toBeLessThanOrEqual(16384);
        expect(chunk.every(byte => byte === (token.kind === "text" ? 121 : 120))).toBe(true);
        await Promise.resolve(); bytes += chunk.length;
      }
      expect(bytes).toBe(token.range.length);
    }
  }
  expect(kinds).toEqual(["start-name", "attribute-name", "attribute-value", "start-end", "text", "end-name"]);
  expect(written).toBeGreaterThan(2 * 1024 * 1024);
  expect(peak).toBeLessThanOrEqual(16384);
  await xml.close(); expect(closed).toBe(1); expect(await fs.readdir("/")).toEqual([]);
  await expect(xml.tokens().next()).rejects.toMatchObject({ code: "invalid-handle" });
});

it("handles split UTF-16, quoted delimiters, comments, CDATA and instructions", async () => {
  const text = '<?xml version="1.0" encoding="UTF-16"?><p:a x="α > β"><!-- > --><![CDATA[a<b]]><?p x?></p:a>';
  const bytes = new Uint8Array(2 + text.length * 2); bytes.set([255, 254]);
  for (let n = 0; n < text.length; n++) { bytes[2 + n * 2] = text.charCodeAt(n) & 255; bytes[3 + n * 2] = text.charCodeAt(n) >>> 8; }
  const xml = await openRetainedXml((async function* () { for (const byte of bytes) yield new Uint8Array([byte]); })(),
    { workingStorage: { fs: createMemoryFileSystem(), directory: "/" } });
  expect(xml.encoding).toBe("utf-16le"); expect(xml.bom).toBe(true);
  const values: string[] = [];
  const value = async (range: XmlRange) => { let text = ""; for await (const bytes of xml.read(range)) text += new TextDecoder().decode(bytes); return text; };
  for await (const token of xml.tokens()) values.push(`${token.kind}:${await value(token.range)}`);
  expect(values).toEqual(['instruction:xml version="1.0" encoding="UTF-16"', 'start-name:p:a', 'attribute-name:x',
    'attribute-value:α > β', 'start-end:', 'comment: > ', 'cdata:a<b', 'instruction:p x', 'end-name:p:a']);
  await xml.close();
});

for (const text of ['<a x="unterminated>', '<!-- a--b -->', '<!DOCTYPE a>', '<a / >', '<a x="<"/>', '<![CDATA[no end', '<a x=no/>']) {
  it(`rejects malformed lexical XML: ${text}`, async () => {
    const fs = createMemoryFileSystem();
    const xml = await openRetainedXml((async function* () { yield encode(text); })(), { workingStorage: { fs, directory: "/" } });
    await expect((async () => { for await (const token of xml.tokens()) void token; })()).rejects.toMatchObject({ code: "invalid-xml" });
    await xml.close(); expect(await fs.readdir("/")).toEqual([]);
  });
}

it("recognizes overlapping CDATA terminators", async () => {
  const xml = await openRetainedXml((async function* () { yield encode('<a><![CDATA[x]]]></a>'); })(),
    { workingStorage: { fs: createMemoryFileSystem(), directory: "/" } });
  let text = "";
  for await (const token of xml.tokens()) if (token.kind === "cdata") for await (const bytes of xml.read(token.range)) text += new TextDecoder().decode(bytes);
  expect(text).toBe("x]"); await xml.close();
});

for (const attribute of [false, true]) it(`streams XML value normalization and entity expansion: attribute=${attribute}`, async () => {
  const text = 'α\r\nβ\rγ\t&amp;&lt;&gt;&quot;&apos;&#13;&#x1F642;';
  const xml = await openRetainedXml((async function* () { yield encode(text); })(),
    { workingStorage: { fs: createMemoryFileSystem(), directory: "/" } });
  let result = "";
  for await (const bytes of xml.value({ start: 0, length: xml.byteLength }, attribute)) result += new TextDecoder().decode(bytes);
  expect(result).toBe((attribute ? 'α β γ ' : 'α\nβ\nγ\t') + '&<>"\'\r🙂');
  await xml.close();
});

for (const text of ['&#65;&;', '&unknown;', '&#0;', '&#xD800;', '&#1114112;', '&#x;', '&amp', 'a]]>b']) it(`rejects invalid XML character content: ${text}`, async () => {
  const xml = await openRetainedXml((async function* () { yield encode(text); })(),
    { workingStorage: { fs: createMemoryFileSystem(), directory: "/" } });
  await expect((async () => { for await (const bytes of xml.value({ start: 0, length: xml.byteLength })) void bytes; })()).rejects.toMatchObject({ code: "invalid-xml" });
  await xml.close();
});

for (const mode of ["cancel", "source-error", "invalid-encoding", "limit"] as const) it(`retires XML storage after admission ${mode}`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController();
  const open = fs.open!.bind(fs); let opened = 0, closed = 0, returned = false;
  fs.open = async (...args) => {
    opened++; const handle = await open(...args);
    return new Proxy(handle, { get(target, key) {
      if (key === "close") return async (...parameters: Parameters<typeof handle.close>) => { closed++; await handle.close(...parameters); };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  const source = (async function* () {
    try {
      const chunk = new Uint8Array(16384).fill(120);
      for (let n = 0; n < 4; n++) yield chunk;
      if (mode === "cancel") controller.abort(new Error("cancelled"));
      if (mode === "source-error") throw new Error("source failed");
      yield mode === "invalid-encoding" ? new Uint8Array([255]) : chunk;
    } finally { returned = true; }
  })();
  await expect(openRetainedXml(source, { workingStorage: { fs, directory: "/", cacheBytes: 16384 },
    signal: controller.signal, xmlLimits: { maxBytes: mode === "limit" ? 65536 : Infinity }
  })).rejects.toMatchObject({ code: mode === "cancel" ? "cancelled" : mode === "source-error" ? "io-failure" : mode === "limit" ? "resource-limit" : "invalid-xml" });
  expect(returned).toBe(true); expect(opened).toBe(1); expect(closed).toBe(1); expect(await fs.readdir("/")).toEqual([]);
});

it("decodes arbitrarily long numeric references without retaining digit strings", async () => {
  const fs = createMemoryFileSystem();
  const source = (async function* () {
    yield encode('&#'); const zeros = new Uint8Array(16384).fill(48);
    for (let n = 0; n < 80; n++) yield zeros;
    yield encode('65;');
  })();
  const xml = await openRetainedXml(source, { workingStorage: { fs, directory: "/", cacheBytes: 16384 } });
  let result = "";
  for await (const bytes of xml.value({ start: 0, length: xml.byteLength })) result += new TextDecoder().decode(bytes);
  expect(result).toBe("A"); await xml.close();
});

it("allows the CDATA terminator as literal attribute content", async () => {
  const xml = await openRetainedXml((async function* () { yield encode(']]>'); })(),
    { workingStorage: { fs: createMemoryFileSystem(), directory: "/" } });
  let result = "";
  for await (const bytes of xml.value({ start: 0, length: xml.byteLength }, true)) result += new TextDecoder().decode(bytes);
  expect(result).toBe(']]>'); await xml.close();
});
