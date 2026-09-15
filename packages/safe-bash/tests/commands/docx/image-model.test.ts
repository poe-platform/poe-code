import assert from "node:assert/strict";
import test from "node:test";
import { paragraph, textFixture, textContext } from "../../../../docx/tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { rasterPng } from "../../../../docx/tests/fixtures/raster.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { Shell } from "../../../src/shell/index.js";

test("explicit docx plugin awaits image factories through a virtual script and preserves the input", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const input = await textFixture(paragraph("Harbor"));
  await fs.writeFile("/work/input.docx", input);
  await fs.writeFile("/work/Map.PNG", rasterPng());
  const batch = { version: 1, operations: [
    { operation: "model.image.image.Image.from_file.call", arguments: { imageDescriptor: { kind: "vfs", path: "Map.PNG", capability: "command" } }, resultHandle: "image" },
    { operation: "model.image.image.Image.filename.get", receiver: { resultHandle: "image" }, arguments: {} },
    { operation: "model.image.image.Image.sha1.get", receiver: { resultHandle: "image" }, arguments: {} }
  ] };
  await fs.writeFile("/work/ops.json", new TextEncoder().encode(JSON.stringify(batch)));
  await fs.writeFile("/work/image.sh", new TextEncoder().encode("docx batch input.docx --ops-json \"$(cat ops.json)\" --json > result.json\ncat result.json\n"));
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try {
    const result = await shell.exec("sh image.sh");
    assert.equal(result.exitCode, 0);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.affected, 0);
    assert.deepEqual(envelope.data.output, []);
    assert.equal(envelope.data.results[0].value.owner, "batch");
    assert.equal(envelope.data.results[1].value, "Map.PNG");
    assert.equal(envelope.data.results[2].value.length, 40);
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
  } finally { await shell.dispose(); }
});
