import assert from "node:assert/strict";
import test from "node:test";
import { paragraph, textFixture, textContext } from "../../../../docx/tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { Shell } from "../../../src/shell/index.js";
import { equationFixture, equationContext, inlineEquation } from "../../../../docx/tests/fixtures/equations.js";
import { openDocumentLocations } from "../../../../docx/src/locations.js";
import { inspectDocumentEquations } from "../../../../docx/src/index.js";
import { readDocumentArchive } from "../../../../docx/src/admission.js";

test("explicit equation plugin reads physical inventory and rejects scope", async () => {
  const input = await textFixture(paragraph("Original passage")), fs = new MemoryFileSystem();
  await fs.mkdir("/work"); await fs.writeFile("/work/input.docx", input);
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try {
    const listed = await shell.exec("docx equations list input.docx --json");
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout).data, { items: [], globalProperties: [] });
    assert.equal((await shell.exec("docx equations list input.docx --scope body --json")).exitCode, 2);
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
  } finally { await shell.dispose(); }
});

for (const strict of [false, true]) test(`actual Shell pairs physical units, explicit fragment append/replace and refusal (${strict})`, async () => {
  const input = await equationFixture({ strict }), fs = new MemoryFileSystem();
  await fs.mkdir("/work"); await fs.writeFile("/work/input.docx", input);
  await fs.writeFile("/work/fragment.xml", new TextEncoder().encode(inlineEquation(strict, "b")));
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: equationContext.limits }) }));
  try {
    const listed = await shell.exec("docx equations list input.docx --json"); assert.equal(listed.exitCode, 0, listed.stderr);
    const initial = JSON.parse(listed.stdout), sdk = await inspectDocumentEquations(input, {}, equationContext);
    assert.deepEqual(initial.data, { items: sdk.items, globalProperties: sdk.globalProperties }); assert.deepEqual(initial.warnings, sdk.warnings);
    assert.equal(initial.data.items.length, 2);
    assert.deepEqual(initial.data.items.map((item: { details: { mode: string; mathPaths: unknown[] } }) => [item.details.mode, item.details.mathPaths.length]), [["inline", 1], ["display", 2]]);
    const locations = await openDocumentLocations(input, equationContext), paragraphToken = locations.at("paragraph", 1).token;
    await fs.writeFile("/work/virtual.sh", new TextEncoder().encode(`docx equations add input.docx --select ${paragraphToken} --file fragment.xml --output -\n`));
    const scripted = await shell.exec("sh virtual.sh"); assert.equal(scripted.exitCode, 0, scripted.stderr); assert.equal(scripted.stderr, "");
    assert.deepEqual([...scripted.stdoutBytes.slice(0, 4)], [80, 75, 3, 4]);
    await readDocumentArchive(scripted.stdoutBytes, equationContext);
    const added = await shell.exec(`docx equations add input.docx --select ${paragraphToken} --file fragment.xml --output added.docx --json`);
    assert.equal(added.exitCode, 0, added.stderr); const append = JSON.parse(added.stdout); assert.equal(append.affected, 1); assert.equal(append.locations.length, 1);
    assert.deepEqual(scripted.stdoutBytes, await fs.readFile("/work/added.docx"));
    const piped = await shell.exec(`cat fragment.xml | docx equations add input.docx --select ${paragraphToken} --file - --output piped.docx --json`);
    assert.equal(piped.exitCode, 0, piped.stderr); assert.equal(JSON.parse(piped.stdout).affected, 1);
    assert.deepEqual(await fs.readFile("/work/piped.docx"), await fs.readFile("/work/added.docx"));
    const doubleStdin = await shell.exec(`docx equations add - --select ${paragraphToken} --file - --output refused.docx --json`);
    assert.equal(doubleStdin.exitCode, 2);
    const after = await shell.exec("docx equations list added.docx --json"); assert.equal(after.exitCode, 0, after.stderr);
    assert.equal(JSON.parse(after.stdout).data.items.length, 3);
    const replaced = await shell.exec(`docx equations replace input.docx --select ${initial.data.items[0].location.token} --file fragment.xml --output replaced.docx --json`);
    assert.equal(replaced.exitCode, 0, replaced.stderr); assert.equal(JSON.parse(replaced.stdout).affected, 1);
    const current = await shell.exec("docx equations list replaced.docx --json"); assert.equal(current.exitCode, 0, current.stderr);
    const unchanged = await shell.exec(`docx equations replace replaced.docx --select ${JSON.parse(current.stdout).data.items[0].location.token} --file fragment.xml --dry-run --json`);
    assert.equal(unchanged.exitCode, 0, unchanged.stderr); assert.equal(JSON.parse(unchanged.stdout).affected, 0);
    const stale = await shell.exec(`docx equations replace added.docx --select ${initial.data.items[0].location.token} --file fragment.xml --output refused.docx --json`);
    assert.equal(stale.exitCode, 1); assert.equal(JSON.parse(stale.stdout).errors[0].code, "stale-selection");
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
  } finally { await shell.dispose(); }
});
