import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
const { NativeSseParser } = createRequire(import.meta.url)("../dist/tiny-mcp-client-rust.node");
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const { SseParser: ReferenceParser } = await tsImport("../../tiny-mcp-client/src/internal.ts", import.meta.url);
function compare(chunks, limit = 1024) {
  const actual = new NativeSseParser(limit); const expected = new ReferenceParser(limit);
  for (const chunk of chunks) {
    assert.deepEqual(actual.push(chunk), expected.push(chunk));
    assert.equal(actual.lastEventId ?? undefined, expected.lastEventId);
  }
  assert.deepEqual(actual.flush(), expected.flush());
  assert.equal(actual.lastEventId ?? undefined, expected.lastEventId);
}
test("native SSE framing matches reference for every split of field and line-ending fixtures", () => {
  const fixtures = ["data: first\r\rdata: second\r\r", "id: completed\ndata: hello\n\nid: unseen\ndata: unfinished\n", "id: \nevent: other\ndata: ignored\n\ndata:\ndata: value\n\n", "id: bad\0id\nevent: message\ndata: 🦊\ud800\n\n", ":comment\r\ndata: leading\r\n\r\n", "data: one\r\n\r\ndata: two\n\n", "unknown: ignored\ndata: a\ndata: b\n\n", "data: unfinished", "data: unfinished\n", "data: unfinished\r"];
  for (const fixture of fixtures) for (let split = 0; split <= fixture.length; split++) compare([fixture.slice(0, split), "", fixture.slice(split)]);
});
test("native SSE bounds lines, metadata and accumulated data with reference diagnostics", () => {
  for (const limit of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => new NativeSseParser(limit), { message: "SSE event byte limit must be a positive safe integer" });
  for (const chunks of [["data: " + "😃".repeat(3)], ["data: 12345678\n", "data: 12345678\n"], ["event: 1234567890\n", "id: 1234567890\n"], [":" + "x".repeat(16) + "\n"]]) {
    for (const Factory of [NativeSseParser, ReferenceParser]) {
      const parser = new Factory(16);
      assert.throws(() => { for (const chunk of chunks) parser.push(chunk); }, { message: "SSE event exceeds 16 bytes" });
    }
  }
  compare([":ping\n".repeat(1024), "data: 12345678\n\n".repeat(128)], 16);
});
test("seeded UTF16 event streams preserve filtering, raw values and cursor across arbitrary chunks", () => {
  let seed = 0x64ee3a10;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  for (let sample = 0; sample < 128; sample++) {
    let stream = "";
    for (let event = 0; event < 12; event++) {
      const end = ["\n", "\r", "\r\n"][random() % 3];
      const value = String.fromCharCode(random() & 65535, random() & 65535);
      stream += `id: ${sample}:${event}${end}event: ${random() % 3 === 0 ? "other" : "message"}${end}data: ${value}${end}data: tail${end}${end}`;
    }
    const chunks = [];
    for (let position = 0; position < stream.length;) { const count = 1 + random() % 17; chunks.push(stream.slice(position, position += count)); }
    compare(chunks, 128);
  }
});
