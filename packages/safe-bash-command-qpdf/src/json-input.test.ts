import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfFileSource, QpdfJsonDocument } from "@poe-code/pdf-ast";
import { applyJsonInput } from "./json-input.js";

const invalid = ["", "{", "{ ", "{x", '{"a":1,}', "[1,]", "[1 x]", '{"a":1 x}', '{"a" x}', "1x", "-", "1.", "1e+", '"abc', '"a\\', '"a\\u1', '"a\\q"', '"a\n"', "truX", "x", "undefined", "NaN", "Infinity", "[object Object]", "[", "[1,", '{"a":', '{"a"', '{"a":true,', "[true", "[01]", "{\r\n\"a\":1 x}", "{\n\r\"a\":1 x}", "[falsex]", "[nullx]", "[tru]", "[1.e1]", "[1e]", "[1e-]", "[-x]", '["\\uXX"]', '"a\\u', '["😀",x]', '["😀" x]', '"\ud800\n"'];
const sample = '{"a":[0,-12.5e+3,true,false,null,"é😀\\u0020"],"b":{}}';
for (let at = 0; at < sample.length; at++) {
  for (const input of [sample.slice(0, at), sample.slice(0, at) + "!" + sample.slice(at + 1)]) {
    try { JSON.parse(input); } catch { invalid.push(input); }
  }
}
for (const input of [...invalid, ...[0, 9, 10, 11, 19, 20, 21, 100, 70000].flatMap(size => [" ".repeat(size) + "x", " ".repeat(size) + "x" + " ".repeat(40), '["' + "a".repeat(size) + '",x]'])]) it(`matches native JSON diagnostics ${JSON.stringify(input.slice(0, 45))} (${input.length})`, async () => {
  let expected = ""; try { JSON.parse(input); assert.fail("invalid fixture"); } catch (error) { expected = (error as Error).message; }
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", new TextEncoder().encode(input));
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file diagnostic I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const source = await PdfFileSource.open(guarded, "/input"), owner = new QpdfJsonDocument({ fs: guarded, directory: "/scratch" });
  try { await assert.rejects(applyJsonInput(owner, source, {}, new AbortController().signal), error => { assert.equal((error as Error).message, expected); return true; }); }
  finally { await owner.close(); await source.close(); }
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
