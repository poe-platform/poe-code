import assert from "node:assert/strict";
import test from "node:test";
import { layoutContext, layoutFixture } from "../../../../docx/tests/fixtures/image-layout.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { Shell } from "../../../src/shell/index.js";

test("image layout edits run through a virtual script and preserve binary pipe bytes", async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/work");
  const input = await layoutFixture(); await fs.writeFile("/work/input.docx", input);
  await fs.writeFile("/work/layout.sh", new TextEncoder().encode("docx images set input.docx --image 1 --alt 'New alt' --output - | cat > edited.docx\ndocx images get edited.docx --image 1 --json\n"));
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: layoutContext.limits }) }));
  try {
    const result = await shell.exec("sh layout.sh"); assert.equal(result.exitCode, 0, result.stderr);
    const envelope = JSON.parse(result.stdout); assert.equal(envelope.data.item.details.alt, "New alt");
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
    const edited = await fs.readFile("/work/edited.docx"); assert.deepEqual([...edited.slice(0, 4)], [80, 75, 3, 4]);
  } finally { await shell.dispose(); }
});

test("layout dry-run reports distinct physical drawings and leaves package bytes exact", async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/work"); const input = await layoutFixture({ copies: 2 }); await fs.writeFile("/work/input.docx", input);
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: layoutContext.limits }) }));
  try {
    const result = await shell.exec("docx images set input.docx --all --width 1in --dry-run --json"); assert.equal(result.exitCode, 0, result.stderr);
    const envelope = JSON.parse(result.stdout); assert.equal(envelope.affected, 2); assert.equal(envelope.locations.length, 2);
    assert.deepEqual(envelope.data.changes.map((change: { kind: string }) => change.kind), ["set", "set"]);
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
  } finally { await shell.dispose(); }
});

test("layout refuses every publication when all includes an unsupported drawing", async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/work");
  const input = await layoutFixture({ copies: 2, alter(files) {
    const xml = new TextDecoder().decode(files.get("word/document.xml"));
    const begin = xml.indexOf("<wp:anchor", xml.indexOf("<wp:anchor") + 1), end = xml.indexOf("</wp:anchor>", begin) + "</wp:anchor>".length;
    const second = xml.slice(begin, end).replace('<a:ext cx="1828800"', '<a:ext cx="1828801"');
    files.set("word/document.xml", new TextEncoder().encode(xml.slice(0, begin) + second + xml.slice(end)));
  } });
  await fs.writeFile("/work/input.docx", input); await fs.writeFile("/work/output.docx", new Uint8Array([13, 255, 0]));
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: layoutContext.limits }) }));
  try {
    const result = await shell.exec("docx images set input.docx --all --width 1in --output output.docx --force --json");
    assert.equal(result.exitCode, 1); const envelope = JSON.parse(result.stdout); assert.equal(envelope.errors[0].code, "unsupported-edit"); assert.equal(envelope.affected, 0);
    assert.deepEqual(await fs.readFile("/work/input.docx"), input); assert.deepEqual(await fs.readFile("/work/output.docx"), new Uint8Array([13, 255, 0]));
  } finally { await shell.dispose(); }
});
