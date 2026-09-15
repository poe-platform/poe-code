import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { paragraph, textFixture, textContext } from "../../../../docx/tests/fixtures/text.js";
import { rasterPng } from "../../../../docx/tests/fixtures/raster.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { readArchive } from "../../../../docx/src/archive.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { Shell } from "../../../src/shell/index.js";

const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="9999" height="7777"/>');
test("SVG fallback insertion preserves both resources through a virtual script and binary pipeline", async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/work"); const input = await textFixture(paragraph("Original area")), png = rasterPng();
  await fs.writeFile("/work/input.docx", input); await fs.writeFile("/work/vector.svg", svg); await fs.writeFile("/work/pixel.png", png);
  await fs.writeFile("/work/insert.sh", new TextEncoder().encode("docx images add input.docx --paragraph 1 --file vector.svg --fallback pixel.png --output - | cat > edited.docx\ndocx images get edited.docx --image 1 --json\n"));
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try {
    const result = await shell.exec("sh insert.sh"); assert.equal(result.exitCode, 0, result.stderr);
    const item = JSON.parse(result.stdout).data.item; assert.equal(item.details.mime, "image/png"); assert.equal(item.details.sha256, createHash("sha256").update(png).digest("hex"));
    assert.equal(item.details.fallbackPart, item.details.part); assert.equal(item.details.alternateParts.length, 1);
    const edited = await fs.readFile("/work/edited.docx"), archive = await readArchive(edited, textContext);
    assert.deepEqual(archive.members.find(member => member.name === item.details.part.slice(1))?.bytes, png);
    assert.deepEqual(archive.members.find(member => member.name === item.details.alternateParts[0].slice(1))?.bytes, svg);
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
  } finally { await shell.dispose(); }
});

test("only the explicit CLI fallback dash consumes the raster stdin stream", async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/work"); await fs.writeFile("/work/input.docx", await textFixture(paragraph("Original area"))); await fs.writeFile("/work/vector.svg", svg); await fs.writeFile("/work/pixel.png", rasterPng());
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try {
    const result = await shell.exec("cat pixel.png | docx images add input.docx --paragraph 1 --file vector.svg --fallback - --output - | docx images get - --image 1 --json");
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(JSON.parse(result.stdout).data.item.details.alternateParts.length, 1);
  } finally { await shell.dispose(); }
});
