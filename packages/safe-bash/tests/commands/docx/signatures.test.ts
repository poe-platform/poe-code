import assert from "node:assert/strict";
import test from "node:test";
import { signatureFixture } from "../../../../docx/tests/fixtures/signatures.js";
import { textContext } from "../../../../docx/tests/fixtures/text.js";
import { inspectDocumentSignatures } from "../../../../docx/src/index.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { Shell } from "../../../src/shell/index.js";

test("VFS script explicitly strips multiple signatures before its separate text edit", async () => {
  const input = await signatureFixture(), fs = new MemoryFileSystem();
  await fs.mkdir("/work"); await fs.writeFile("/work/signed record.docx", input);
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try {
    const listed = await shell.exec("docx signatures list 'signed record.docx' --json");
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout).data, await inspectDocumentSignatures(input, {}, textContext));
    assert.equal(JSON.parse(listed.stdout).data.items.length, 4);
    const refused = await shell.exec("docx text replace 'signed record.docx' --find Harbor --with Coastal --all -o refused.docx --json");
    assert.equal(refused.exitCode, 1);
    await assert.rejects(fs.readFile("/work/refused.docx"));
    const limited = await shell.exec("docx signatures remove 'signed record.docx' -o limited.docx --json --limit serializedOutput=1");
    assert.equal(limited.exitCode, 4);
    await assert.rejects(fs.readFile("/work/limited.docx"));
    assert.deepEqual(await fs.readFile("/work/signed record.docx"), input);
    await fs.writeFile("/work/inplace.docx", input);
    const inPlace = await shell.exec("docx signatures remove inplace.docx --in-place --json");
    assert.equal(inPlace.exitCode, 0, inPlace.stderr);
    assert.deepEqual(await inspectDocumentSignatures(await fs.readFile("/work/inplace.docx"), {}, textContext), { items: [], relationships: [], verified: null });
    const binary = await shell.exec("docx signatures remove 'signed record.docx' -o -");
    assert.equal(binary.exitCode, 0, binary.stderr);
    assert.deepEqual([...binary.stdoutBytes.slice(0, 4)], [80, 75, 3, 4]);
    assert.deepEqual(await inspectDocumentSignatures(binary.stdoutBytes, {}, textContext), { items: [], relationships: [], verified: null });
    await fs.writeFile("/work/strip.sh", new TextEncoder().encode("docx signatures remove 'signed record.docx' -o stripped.docx --json && docx text replace stripped.docx --find Harbor --with Coastal --all -o edited.docx --json\n"));
    const scripted = await shell.exec("sh strip.sh");
    assert.equal(scripted.exitCode, 0, scripted.stderr);
    const reports = scripted.stdout.trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(reports.map(report => report.operation), ["signatures.remove", "text.replace"]);
    assert.equal(reports[0].affected, 6);
    assert.equal(reports[0].data.removedParts.length, 6);
    const stripped = await inspectDocumentSignatures(await fs.readFile("/work/stripped.docx"), {}, textContext);
    assert.deepEqual(stripped, { items: [], relationships: [], verified: null });
    assert.equal((await shell.exec("docx text edited.docx")).stdout.trim(), "Coastal records");
    assert.deepEqual(await fs.readFile("/work/signed record.docx"), input);
  } finally { await shell.dispose(); }
});

test("unsafe incoming signature ownership preserves both input and existing destination", async () => {
  const input = await signatureFixture("incoming"), fs = new MemoryFileSystem();
  await fs.mkdir("/work"); await fs.writeFile("/work/input.docx", input);
  const retained = new TextEncoder().encode("existing destination"); await fs.writeFile("/work/output.docx", retained);
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try {
    const result = await shell.exec("docx signatures remove input.docx -o output.docx --force --json");
    assert.equal(result.exitCode, 1);
    assert.equal(JSON.parse(result.stdout).affected, 0);
    const inPlace = await shell.exec("docx signatures remove input.docx --in-place --json");
    assert.equal(inPlace.exitCode, 1);
    assert.deepEqual(await fs.readFile("/work/input.docx"), input);
    assert.deepEqual(await fs.readFile("/work/output.docx"), retained);
  } finally { await shell.dispose(); }
});
