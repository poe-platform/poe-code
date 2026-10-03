import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import type { CommandContext, CommandDefinition } from "safe-bash-contracts";
import {
  createPdfdetachCommand, createPdffontsCommand, createPdfinfoCommand,
  createPdfseparateCommand, createPdfuniteCommand,
  runPdfdetachCli, runPdfdetachCliSync, runPdffontsCli, runPdffontsCliSync,
  runPdfseparateCli, runPdfuniteCli,
} from "./index.js";

const doc = PdfDocument.create();
doc.addPage([8, 8]);
const pdf = doc.save();

async function execute(command: CommandDefinition, args: string[]) {
  let reads = 0;
  let stdout = "", stderr = "";
  let context = {
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { reads++; yield pdf; } },
    fs: { async readFile() { throw new Error("unexpected file read"); } },
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
  } as unknown as CommandContext;
  if ((command.name === "pdfdetach" || command.name === "pdffonts")) { const fs = createMemoryFileSystem(); await fs.mkdir("/tmp"); context = { ...context, fs }; }
  const result = await command.execute(context);
  return { ...result, reads, stdout, stderr };
}

for (const create of [createPdfuniteCommand, createPdfseparateCommand, createPdffontsCommand, createPdfdetachCommand]) {
  for (const args of [[], ["-upw", "--help"]]) {
    it(`${create().name} ${args.join(" ")} rejects an omitted PDF without consuming stdin`, async () => {
      const result = await execute(create(), args);
      assert.equal(result.reads, 0);
      assert.equal(result.exitCode, 99);
      assert.equal(result.stdout, "");
      assert.notEqual(result.stderr, "");
    });
  }
}

for (const run of [runPdfuniteCli, runPdfseparateCli, runPdffontsCli, runPdffontsCliSync, runPdfdetachCli, runPdfdetachCliSync]) {
  it(`${run.name} requires a PDF operand even when stdin bytes are staged`, async () => {
    const files = new Map([["-", pdf]]);
    const result = await run([], files);
    assert.equal(result.exitCode, 99);
    assert.equal(result.stdout, "");
    assert.notEqual(result.stderr, "");
    assert.deepEqual([...files.keys()], ["-"]);
  });
}

for (const create of [createPdffontsCommand, createPdfdetachCommand, createPdfinfoCommand]) {
  it(`${create().name} reads an explicit stdin operand`, async () => {
    const result = await execute(create(), ["-"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.reads, 1);
    assert.notEqual(result.stdout, "");
  });
}

it("pdfinfo still reads stdin when the PDF operand is omitted", async () => {
  const result = await execute(createPdfinfoCommand(), []);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.reads, 1);
  assert.ok(result.stdout.includes("Pages:"));
});
