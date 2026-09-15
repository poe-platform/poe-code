import assert from "node:assert/strict";
import test from "node:test";
import { replacementFixture, replacementPng, textContext } from "../../../../docx/tests/fixtures/image-replacement.js";
import { rasterGif } from "../../../../docx/tests/fixtures/raster.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { Shell } from "../../../src/shell/index.js";

test("explicit image replacement preserves other occurrences through a virtual script and binary pipeline", async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/work");
  const input = await replacementFixture(2); await fs.writeFile("/work/input.docx", input); await fs.writeFile("/work/Map.GIF", rasterGif());
  await fs.writeFile("/work/replace.sh", new TextEncoder().encode("docx images replace input.docx --image 1 --file Map.GIF --output - | docx images list - --json > result.json\ncat result.json\n"));
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try { const result = await shell.exec("sh replace.sh"); assert.equal(result.exitCode, 0, result.stderr); const envelope = JSON.parse(result.stdout); assert.deepEqual(envelope.data.items.map((item: { details: { mime: string } }) => item.details.mime), ["image/gif", "image/png"]); assert.deepEqual(await fs.readFile("/work/input.docx"), input); } finally { await shell.dispose(); }
});
test("explicit shared image replacement reports every physical owner in command JSON", async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/work"); const input = await replacementFixture(2); await fs.writeFile("/work/input.docx", input); await fs.writeFile("/work/Map.PNG", replacementPng(89));
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try { const result = await shell.exec("docx images replace input.docx --image 1 --file Map.PNG --shared --dry-run --json"); assert.equal(result.exitCode, 0, result.stderr); const envelope = JSON.parse(result.stdout); assert.equal(envelope.affected, 2); assert.equal(envelope.locations.length, 2); assert.deepEqual(envelope.data.changes.map((change: { kind: string }) => change.kind), ["replace", "replace"]); assert.deepEqual(await fs.readFile("/work/input.docx"), input); } finally { await shell.dispose(); }
});
