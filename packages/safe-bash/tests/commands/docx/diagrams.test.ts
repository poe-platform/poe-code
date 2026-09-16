import assert from "node:assert/strict";
import test from "node:test";
import { paragraph, textFixture, textContext } from "../../../../docx/tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { Shell } from "../../../src/shell/index.js";
import { diagramFixture, diagramCarrier, diagramContext } from "../../../../docx/tests/fixtures/diagrams.js";
import { inspectDocumentDiagrams } from "../../../../docx/src/index.js";

test("actual Shell retains native and unknown physical records and precisely refuses destructive graphics edits", async () => {
  const input = await diagramFixture({ body: '<w:p><w:r><w:t>Original passage</w:t></w:r>' + diagramCarrier() + '</w:p><w:p>' + diagramCarrier(false, "urn:original:graphics").replace('id="1"', 'id="2"') + '</w:p>' });
  const fs = new MemoryFileSystem(); await fs.mkdir("/work"); await fs.writeFile("/work/input.docx", input);
  const destination = new Uint8Array([4, 8, 2]); await fs.writeFile("/work/output.docx", destination);
  await fs.writeFile("/work/edit.xml", new TextEncoder().encode('<d:dataModel xmlns:d="http://schemas.openxmlformats.org/drawingml/2006/diagram"><d:ptLst/></d:dataModel>'));
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: diagramContext.limits }) }));
  try {
    const listed = await shell.exec("docx diagrams list input.docx --json"); assert.equal(listed.exitCode, 0, listed.stderr);
    const inventory = JSON.parse(listed.stdout), sdk = await inspectDocumentDiagrams(input, {}, diagramContext);
    assert.deepEqual(inventory.data.items, sdk.items); assert.deepEqual(inventory.warnings, sdk.warnings); assert.equal(inventory.data.items.length, 5);
    for (const command of ["docx xml set input.docx --part /word/graphs/data.xml --file edit.xml --output output.docx --force --json", "docx paragraphs set input.docx --paragraph 2 --text Altered --output output.docx --force --json"]) {
      const rejected = await shell.exec(command); assert.equal(rejected.exitCode, 1, rejected.stderr);
      const failure = JSON.parse(rejected.stdout); assert.equal(failure.ok, false); assert.equal(failure.affected, 0); assert.equal(failure.errors[0].code, "unsupported-edit", command + "\n" + rejected.stderr);
      assert.equal(failure.locations.length, 1); assert.equal(failure.errors[0].location, failure.locations[0].token);
      assert.equal(failure.locations[0].kind, command.includes("xml set") ? "part" : "paragraph");
      assert.deepEqual(await fs.readFile("/work/output.docx"), destination);
    }
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
  } finally { await shell.dispose(); }
});

test("explicit diagram plugin reads an empty physical inventory and refuses scoped options", async () => {
  const input = await textFixture(paragraph("Original bounded passage")), fs = new MemoryFileSystem();
  await fs.mkdir("/work"); await fs.writeFile("/work/input.docx", input);
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try {
    const result = await shell.exec("docx diagrams list input.docx --json");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).data, { items: [] });
    assert.equal(JSON.parse(result.stdout).affected, 0);
    const rejected = await shell.exec("docx diagrams list input.docx --scope headers --json");
    assert.equal(rejected.exitCode, 2);
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
  } finally { await shell.dispose(); }
});
