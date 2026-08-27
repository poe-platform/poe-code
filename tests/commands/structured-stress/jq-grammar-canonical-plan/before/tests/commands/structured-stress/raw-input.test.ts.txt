import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { execute } from "./harness.js";

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
for (const fixture of corpus.cases) test(`raw native: ${fixture.id}`, async () => {
  for (const size of [1, 2, 7, 16384]) {
    const fs = new MemoryFileSystem();
    for (const file of fixture.files ?? []) await fs.writeFile(`/${file.path}`, Buffer.from(file.inputHex, "hex"));
    const input = chunks(Buffer.from(fixture.inputHex, "hex"), size);
    const result = await execute(fixture.argv, input, {}, { fs });
    assert.equal(result.status, fixture.policyStatus ?? fixture.status, `${fixture.id} chunk ${size}: ${result.stderr}`);
    assert.equal(result.stdout, fixture.policyStdout ?? fixture.stdout, `${fixture.id} chunk ${size}`);
    if (fixture.policy?.startsWith("strict-utf8")) assert.match(result.stderr, /invalid UTF-8/u);
    else if (fixture.policy) assert.match(result.stderr, /^jq: .{1,1000}\n$/u);
    else if (fixture.status < 5) assert.equal(result.stderr, "");
    else assert.match(result.stderr, /^jq: .{1,1000}\n$/u);
  }
});
