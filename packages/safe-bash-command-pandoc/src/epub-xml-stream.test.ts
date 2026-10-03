import {expect, it, vi} from "vitest";
import {ExecutionContext} from "./execution.js";
import {parseEpubXml} from "./epub-xml.js";

const encode = (text: string) => new TextEncoder().encode(text);
const context = () => new ExecutionContext("read", {limits: {retainedBytes: 65536}, yield: async () => {}});

it("parses XML larger than its working window without retaining the source text", async () => {
  const ctx = context();
  let closed = false;
  const chunks = (async function* () {
    try {
      yield encode('<root xmlns="urn:book">');
      const comment = encode('<!--' + 'x'.repeat(4096) + '-->');
      for (let i = 0; i < 128; i++) yield comment;
      yield encode('<title>Book</title></root>');
    } finally {closed = true;}
  })();
  try {
    const root = await parseEpubXml(chunks, "book.xml", ctx);
    expect(root.children).toEqual([{name: "title", uri: "urn:book", attrs: [], children: ["Book"]}]);
    expect(closed).toBe(true);
  } finally {await ctx.close();}
});

it.each([1, 2, 7, 255, 256, 257])("preserves XML declarations, namespaces and character references through reused %i-byte windows", async width => {
  const bytes = encode('\ufeff<?xml version="1.0" encoding="UTF-8"?><root xmlns="urn:book" xmlns:p="urn:parts" p:title="é&#x1F600;&quot;">\r\n<p:child a="one\r\ntwo">A&#13;B&#10;C&amp;D<![CDATA[é😀\r\nE]]></p:child></root>');
  const first = context(), second = context();
  const window = new Uint8Array(width);
  const chunks = (async function* () {
    try {
      for (let offset = 0; offset < bytes.length; offset += width) {
        const length = Math.min(width, bytes.length - offset);
        window.fill(0); window.set(bytes.subarray(offset, offset + length));
        yield window.subarray(0, length);
      }
    } finally {window.fill(255);}
  })();
  try {expect(await parseEpubXml(chunks, "part.xml", second)).toEqual(await parseEpubXml(bytes, "part.xml", first));}
  finally {await first.close(); await second.close();}
});

it.each([[0xe2, 0x82], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0x80]])("rejects incomplete or invalid UTF-8 sequence %j and closes its source", async (...sequence) => {
  const ctx = context();
  let closed = 0;
  const chunks = (async function* () {
    try {yield encode("<root>"); for (const byte of sequence) yield Uint8Array.of(byte); yield new Uint8Array();}
    finally {closed++;}
  })();
  try {await expect(parseEpubXml(chunks, "part.xml", ctx)).rejects.toMatchObject({code: "E_ENCODING"}); expect(closed).toBe(1);}
  finally {await ctx.close();}
});

it.each(['<!DOCTYPE root [<!ENTITY file SYSTEM "file:///secret">]><root>&file;</root>', '<root>&missing;</root>', '<root></wrong>', '<?xml version="1.0" encoding="UTF-16"?><root/>'])("rejects malformed or forbidden XML through one-byte chunks: %s", async text => {
  const ctx = context();
  let closed = 0;
  const chunks = (async function* () {try {for (const byte of encode(text)) yield Uint8Array.of(byte);} finally {closed++;}})();
  try {await expect(parseEpubXml(chunks, "part.xml", ctx)).rejects.toMatchObject({code: "E_PARSE", location: "part.xml"}); expect(closed).toBe(1);}
  finally {await ctx.close();}
});

it("keeps empty XML source responses cooperative and closes after a checkpoint failure", async () => {
  const ctx = context();
  const stop = new Error("stop empty XML stream");
  let empty = 0, closed = 0;
  const cooperate = ctx.cooperate.bind(ctx);
  vi.spyOn(ctx, "cooperate").mockImplementation(async units => {if (empty > 0) throw stop; await cooperate(units);});
  const chunks = (async function* () {
    try {yield encode("<root>"); for (; empty < 1000; empty++) yield new Uint8Array(); yield encode("</root>");}
    finally {closed++;}
  })();
  try {
    await expect(parseEpubXml(chunks, "part.xml", ctx)).rejects.toBe(stop);
    expect(empty).toBeLessThan(1000);
    expect(closed).toBe(1);
  } finally {await ctx.close();}
});

it("retires a pending XML iterator when its execution context is cancelled", async () => {
  const controller = new AbortController();
  const ctx = new ExecutionContext("read", {signal: controller.signal, yield: async () => {}});
  let enter!: () => void, release!: (result: IteratorResult<Uint8Array>) => void;
  const entered = new Promise<void>(resolve => {enter = resolve;});
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => {release = resolve;});
  let reads = 0, closed = 0;
  const iterator = {
    async next(): Promise<IteratorResult<Uint8Array>> {if (reads++ === 0) return {done: false, value: encode("<root>")}; enter(); return pending;},
    async return(): Promise<IteratorResult<Uint8Array>> {closed++; release({done: true, value: undefined}); return {done: true, value: undefined};}
  };
  const result = ctx.call(() => parseEpubXml({[Symbol.asyncIterator]: () => iterator}, "part.xml", ctx));
  const settled = result.then(() => undefined, error => error);
  try {
    await entered;
    controller.abort(new Error("cancel XML input"));
    expect(await settled).toMatchObject({code: "E_CANCELLED"});
    await ctx.close();
    expect(closed).toBe(1);
  } finally {release({done: true, value: undefined}); await settled; await ctx.close();}
});

it("charges retained attribute payloads even when XML source text is streamed", async () => {
  const ctx = context();
  let closed = 0;
  const chunks = (async function* () {
    try {yield encode('<root title="'); for (let index = 0; index < 32; index++) yield encode("x".repeat(2048)); yield encode('"/>');}
    finally {closed++;}
  })();
  try {await expect(parseEpubXml(chunks, "part.xml", ctx)).rejects.toMatchObject({code: "E_LIMIT"}); expect(closed).toBe(1);}
  finally {await ctx.close();}
});

it("preserves text quotas for streamed discarded comments", async () => {
  const ctx = new ExecutionContext("read", {limits: {text: 128}, yield: async () => {}});
  let closed = 0;
  const chunks = (async function* () {try {yield encode("<root><!--"); for (let index = 0; index < 100; index++) yield encode("discarded"); yield encode("--></root>");} finally {closed++;}})();
  try {await expect(parseEpubXml(chunks, "part.xml", ctx)).rejects.toMatchObject({code: "E_LIMIT"}); expect(closed).toBe(1);}
  finally {await ctx.close();}
});

it.each([1, 2, 256])("preserves established XML 1.1 CR/NEL normalization across %i-byte chunks", async width => {
  const bytes = encode('<?xml version="1.1"?><root title="a\r\u0085b">A\r\u0085B\u0085C\u2028D\r\nE</root>');
  const first = context(), second = context();
  const chunks = (async function* () {for (let offset = 0; offset < bytes.length; offset += width) yield bytes.subarray(offset, offset + width);})();
  try {expect(await parseEpubXml(chunks, "part.xml", second)).toEqual(await parseEpubXml(bytes, "part.xml", first));}
  finally {await first.close(); await second.close();}
});

it.each(["parser", "source"])("preserves the original %s failure when iterator cleanup also fails", async kind => {
  const ctx = context();
  const sourceFailure = {source: "failed"};
  const cleanupFailure = new Error("cleanup failed");
  let calls = 0, closed = 0;
  const iterator = {
    async next(): Promise<IteratorResult<Uint8Array>> {
      if (calls++ === 0) return {done: false, value: encode(kind === "parser" ? "<root></wrong>" : "<root>")};
      throw sourceFailure;
    },
    async return(): Promise<IteratorResult<Uint8Array>> {closed++; throw cleanupFailure;}
  };
  try {
    const result = parseEpubXml({[Symbol.asyncIterator]: () => iterator}, "part.xml", ctx);
    if (kind === "parser") await expect(result).rejects.toMatchObject({code: "E_PARSE"});
    else await expect(result).rejects.toBe(sourceFailure);
    expect(closed).toBe(1);
  } finally {await ctx.close();}
  expect(closed).toBe(1);
});

it("preserves XML trees across UTF-8, BOM, CRLF and entity chunk boundaries", async () => {
  const bytes = encode('\ufeff<root>é😀\r\nA&amp;B<![CDATA[C\rD]]></root>');
  const first = context(), second = context();
  try {
    const expected = await parseEpubXml(bytes, "book.xml", first);
    const chunks = (async function* () {for (const byte of bytes) yield new Uint8Array([byte]);})();
    expect(await parseEpubXml(chunks, "book.xml", second)).toEqual(expected);
  } finally {await first.close(); await second.close();}
});

it("rejects malformed streamed UTF-8 and retires the producer", async () => {
  const ctx = context();
  let closed = false;
  const chunks = (async function* () {try {yield encode('<root>'); yield new Uint8Array([0xc3, 0x28]); yield encode('</root>');} finally {closed = true;}})();
  try {await expect(parseEpubXml(chunks, "book.xml", ctx)).rejects.toMatchObject({code: "E_ENCODING"}); expect(closed).toBe(true);}
  finally {await ctx.close();}
});
