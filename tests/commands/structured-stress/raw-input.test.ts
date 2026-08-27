import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { execute, executeWithBytes } from "./harness.js";
import { assertNative } from "./jq-grammar-native-v3.js";

interface RawFixture {
  id: string;
  argv: string[];
  inputHex: string;
  files?: { path: string; inputHex: string }[];
  stdout: string;
  status: number;
  policy?: string;
  policyStdout?: string;
  policyStatus?: number;
}
const corpus = JSON.parse(readFileSync(new URL("./raw-input-native.json", import.meta.url), "utf8")) as { cases: RawFixture[] };
async function* chunks(bytes: Uint8Array, size: number) {
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
}
const nativeOverrides = new Set(["record-error-prefix","file-unicode:-Rc","file-unicode:-Rsc","invalid:0:-Rc","invalid:0:-Rsc","invalid:1:-Rc","invalid:1:-Rsc","invalid:2:-Rc","invalid:2:-Rsc","invalid:3:-Rc","invalid:3:-Rsc","invalid:4:-Rc","invalid:4:-Rsc"]);
for (const fixture of corpus.cases) test(`raw native: ${fixture.id}`, async () => {
  for (const size of [1, 2, 7, 16384]) {
    const fs = new MemoryFileSystem();
    for (const file of fixture.files ?? []) await fs.writeFile(`/${file.path}`, Buffer.from(file.inputHex, "hex"));
    const input = chunks(Buffer.from(fixture.inputHex, "hex"), size);
    if (nativeOverrides.has(fixture.id)) {
      const result = await executeWithBytes(fixture.argv, input, {}, { fs });
      const files = Object.fromEntries((fixture.files ?? []).map(file => [file.path, file.inputHex]));
      assertNative(result, fixture.argv, Buffer.from(fixture.inputHex, "hex"), files);
      continue;
    }
    const result = await execute(fixture.argv, input, {}, { fs });
    assert.equal(result.status, fixture.policyStatus ?? fixture.status, `${fixture.id} chunk ${size}: ${result.stderr}`);
    assert.equal(result.stdout, fixture.policyStdout ?? fixture.stdout, `${fixture.id} chunk ${size}`);
    if (fixture.policy?.startsWith("strict-utf8")) assert.match(result.stderr, /invalid UTF-8/u);
    else if (fixture.policy) assert.match(result.stderr, /^jq: .{1,1000}\n$/u);
    else if (fixture.status < 5) assert.equal(result.stderr, "");
    else assert.match(result.stderr, /^jq: .{1,1000}\n$/u);
  }
});
