import assert from "node:assert/strict";
import test from "node:test";
import { textFixture, textContext } from "../../../../docx/tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { Shell } from "../../../src/shell/index.js";

test("shape setter publishes through a virtual script and binary pipeline", async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/work");
  const input = await textFixture('<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" id="box"><v:textbox><w:txbxContent><w:p><w:r><w:t>Original box</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>');
  await fs.writeFile("/work/input.docx", input); await fs.writeFile("/work/edit.sh", new TextEncoder().encode('docx shapes set input.docx --shape 1 --text "New box" --output - | cat > edited.docx\ndocx text get edited.docx --scope text-boxes --json\n'));
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try { const result = await shell.exec("sh edit.sh"); assert.equal(result.exitCode, 0, result.stderr); assert.equal(JSON.parse(result.stdout).data.text, "New box"); assert.deepEqual(await fs.readFile("/work/input.docx"), input); }
  finally { await shell.dispose(); }
});
