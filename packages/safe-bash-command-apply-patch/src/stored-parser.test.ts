import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { IndexedDocument } from "safe-bash-diff-engine/document";
import { parse } from "./parser.js";
import { PatchMetadata } from "./metadata.js";
import { parseDocument } from "./stored-parser.js";
import { textChunks, equalText, type StoredText } from "./stored-text.js";
import { Work } from "./shared.js";
import { settings } from "./options.js";

function context(): CommandContext {
  return { command: "apply_patch", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} } };
}
const bodies = [
  "*** Add File: a\n+😀\n+\n+end",
  "*** Delete File: a",
  "*** Update File: a\n*** Move to: b",
  "*** Update File: a\n@@ anchor\n@@ next\n-old\n+new\n*** End of File",
  "*** Update File: a\n@@\n \n-old\n+new",
  "*** Update File: a\n@@\n\n-old\n+new",
  "*** Update File: a\n@@",
  "*** Add File: a\ninvalid",
  "*** Add File: a\n+a\n*** Delete File: a",
  "\ufeff*** Add File: a\n+a",
];
for (const ending of ["\n", "\r\n"]) test(`stored parser preserves grammar and trim semantics: ${JSON.stringify(ending)}`, async () => {
  for (const body of bodies) for (const envelope of [true, false]) {
    const value = envelope ? `\ufeff \n*** Begin Patch\n${body}\n*** End Patch\n\u2003` : body;
    const input = value.split("\n").join(ending);
    const work = new Work(context(), settings({}));
    const document = new IndexedDocument(work);
    const metadata = new PatchMetadata(document, work);
    try {
      await document.load(toByteSource(input));
      const attempt = async (stored: boolean) => {
        try {
          const files = stored ? await parseDocument(document, work, metadata) : await parse(input, work);
          const read = async (value: string | StoredText) => {
            if (typeof value === "string") return value;
            let text = ""; for await (const chunk of textChunks(value)) text += chunk; return text;
          };
          const result = [];
          for (const file of files) {
            const added = [], hunks = [];
            for await (const value of file.added) added.push(await read(value));
            for await (const hunk of file.hunks) {
              const anchors = [], lines = [];
              for await (const value of hunk.anchors) anchors.push(await read(value));
              for await (const line of hunk.lines) lines.push({ ...line, text: await read(line.text) });
              hunks.push({ ...hunk, anchors, lines });
            }
            result.push({ ...file, added, hunks });
          }
          return result;
        } catch (error) { return { message: (error as Error).message }; }
      };
      assert.deepEqual(await attempt(true), await attempt(false), input);
    } finally { await metadata.close(); await document.close(); work.close(); }
  }
});

test("stored comparisons preserve empty and normalized text across chunk boundaries", async () => {
  const work = new Work(context(), settings({}));
  for (const value of ["", "  ", "é😀".repeat(5000), "\u2003".repeat(10000) + "‘old’—" + "\u2003".repeat(10000)]) {
    const document = new IndexedDocument(work);
    try {
      await document.load(toByteSource(value));
      const stored = { document, start: 0, end: document.size };
      for (let pass = 0; pass < 4; pass++) {
        assert.equal(await equalText(stored, value, pass, work), true);
        assert.equal(await equalText(value, stored, pass, work), true);
        assert.equal(await equalText(stored, value + "x", pass, work), false);
      }
      if (value.includes("old")) assert.equal(await equalText(stored, "'old'-", 3, work), true);
    } finally { await document.close(); }
  }
  work.close();
});
