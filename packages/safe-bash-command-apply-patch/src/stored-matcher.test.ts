import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, toByteSource } from "safe-bash-contracts";
import { IndexedDocument } from "safe-bash-diff-engine/document";
import { contents } from "./matcher.js";
import { storedContents } from "./stored-matcher.js";
import { parse } from "./parser.js";
import { settings } from "./options.js";
import { Work } from "./shared.js";

for (const ending of ["\n", "\r\n", ""]) test(`stored matcher preserves buffered semantics: ending=${JSON.stringify(ending)}`, async () => {
  const context = { command: "apply_patch", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal };
  for (const body of ["old", "old  ", "  old", "‘old’—", "old\r"]) {
    for (const edit of ["@@\n-old\n+new", "@@ anchor\n+inserted", "@@\n+end\n*** End of File", "@@\n anchor\n-old\n+new", "@@\n-'old'-\n+new", "@@\n-old\n", "@@ anchor\n+one\n@@ old\n+two"]) {
      const input = new TextEncoder().encode(`anchor${ending || "\n"}${body}${ending}`);
      const work = new Work(context, settings({}));
      const files = await parse(`*** Begin Patch\n*** Update File: /file\n${edit}\n*** End Patch`, work);
      const expected = await contents(files[0]!, input, work).then(bytes => ({ bytes }), error => ({ error: error.message }));
      const original = new IndexedDocument(work);
      await original.load(toByteSource(input));
      let result: IndexedDocument | undefined;
      try {
        const actual = await storedContents(files[0]!, original, work).then(async document => {
          result = document;
          return { bytes: await collectBytes(document!.range(0, document!.size), {}) };
        }, error => ({ error: error.message }));
        assert.deepEqual(actual, expected, JSON.stringify({ body, edit }));
      } finally { await result?.close(); await original.close(); work.close(); }
    }
  }
});

test("normalized matching scans long Unicode whitespace without collecting target lines", async () => {
  const fs = createMemoryFileSystem();
  const context = { command: "apply_patch", args: [], cwd: "/", env: {}, fs,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal };
  const work = new Work(context, settings({}));
  const original = new IndexedDocument(work);
  const whitespace = new TextEncoder().encode("\u2000".repeat(4096));
  await original.load({ async *[Symbol.asyncIterator]() {
    for (let index = 0; index < 32; index++) yield whitespace;
    yield new TextEncoder().encode("‘old’—\u2000\r\n");
  } });
  let result: IndexedDocument | undefined;
  try {
    const [file] = await parse("*** Begin Patch\n*** Update File: /file\n@@\n-'old'-\n+new\n*** End Patch", work);
    result = await storedContents(file!, original, work);
    assert.equal(new TextDecoder().decode(await collectBytes(result!.range(0, result!.size), {})), "new\r\n");
  } finally { await result?.close(); await original.close(); work.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});
