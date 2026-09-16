import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { createDocumentArchive, writeDocumentArchive, createDocxInspectionCommandEngine } from "../../../docx/src/index.js";
import { docxCommands } from "../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const limits = { maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 1024, maxCommentBytes: 1024, maxRetainedBytes: 32000000, chunkSize: 1024 };
test("docx Shell applies trusted profiles and cannot raise them with command flags", async () => {
  const signal = new AbortController().signal;
  const archive = await createDocumentArchive({ content: { version: 1, blocks: [{ kind: "paragraph", text: "Coastal observation" }] } }, { limits, signal });
  const chunks: Uint8Array[] = [];
  await writeDocumentArchive(archive, { async write(bytes) { chunks.push(bytes); } }, { order: "name", compression: "store" }, { limits, signal });
  const volume = Volume.fromJSON({ "/input.docx": Buffer.concat(chunks), "/sentinel": "Keep original" });
  const before = volume.toJSON();
  for (const nodes of [1, 10000]) {
    const fs = new MemoryFileSystem();
    fs.readFile = async path => new Uint8Array(volume.readFileSync(path) as Buffer);
    fs.readStream = path => ({ async *[Symbol.asyncIterator]() { yield await fs.readFile(path); } });
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits, documentLimits: { xmlNodes: nodes } }) }));
    const input = { stdin: new Uint8Array(volume.readFileSync("/input.docx") as Buffer) };
    try {
      const result = await shell.exec("docx text replace - --find Coastal --with Harbor --first --dry-run --json", input);
      assert.equal(result.exitCode, nodes === 1 ? 4 : 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).ok, nodes !== 1);
      const lowered = await shell.exec("docx text - --limit xmlNodes=1 --json", input);
      assert.equal(lowered.exitCode, 4, lowered.stderr);
      const raised = await shell.exec(`docx text - --limit xmlNodes=${nodes + 1} --json`, input);
      assert.equal(raised.exitCode, 2, raised.stderr);
    } finally { await shell.dispose(); }
  }
  assert.deepEqual(volume.toJSON(), before);
});
