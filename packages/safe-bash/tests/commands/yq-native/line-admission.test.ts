import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../yq-scripting/helpers.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { parseYamlDocuments } from "../../../src/commands/yq/parser.js";
import { YqLedger } from "../../../src/commands/yq/accounting.js";
import type { YqOwnedWork } from "../../../src/commands/structured/query-core.js";

test("native YAML rejects many short lines below the document byte cap", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/payload", new TextEncoder().encode("\n".repeat(1_600_000) + "a: b\n"));
  const result = await run(["-o", "json", "-c", ".", "/payload"], "", { fs });
  assert.equal(result.status, 5);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /LIMIT_MAX_SOURCE_LINES/u);
});

for (const line of ["\n", "\r", "\r\n", "# x\n"]) {
  test(`native YAML counts ${JSON.stringify(line)} lines at the source quota`, async () => {
    const accepted = await run(["-o", "json", "-c", "."], line.repeat(65_535) + "a: b");
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.stdout, '{"a":"b"}\n');
    const rejected = await run(["-o", "json", "-c", "."], line.repeat(65_536) + "a: b");
    assert.equal(rejected.status, 5);
    assert.match(rejected.stderr, /LIMIT_MAX_SOURCE_LINES/u);
  });
}

for (const input of ["\n".repeat(1024), "#".repeat(1024)]) {
  test(`YAML scanning admits work before accumulating ${input[0] === "\n" ? "blank lines" : "a long line"}`, async () => {
    const failure = new Error("work refused");
    const charges: number[] = [];
    const work = {
      async charge(units: number) { charges.push(units); throw failure; },
      assertOpen() {},
    } as unknown as YqOwnedWork;
    const documents = parseYamlDocuments(input, work, new YqLedger());
    await assert.rejects(documents.next(), error => error === failure);
    assert.deepEqual(charges, [256]);
  });
}

test("incremental YAML lines preserve mixed breaks and block scalar final breaks", async () => {
  for (const [input, expected] of [["a: |\r\n  b\rc: d\n", '{"a":"b\\n","c":"d"}\n'], ["a: |-\n  b", '{"a":"b"}\n']] as const) {
    const result = await run(["-o", "json", "-c", "."], input);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});
