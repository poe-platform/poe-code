import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftohtmlCommand, runPdftohtmlCli } from "./index.js";

for (const full of [false, true]) test(`XML font family with fontfullname=${full}`, async () => {
  const bytes = await readFile(new URL("../../pdf-ast/src/fixtures/pdfjs-pattern_text_embedded_font.pdf", import.meta.url));
  const args = ["-xml", "-stdout", "-i", "-zoom", "1.5", ...(full ? ["-fontfullname"] : []), "/input.pdf"];
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.pdf", bytes);
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const carrier = createCommandArguments(args);
  const result = await createPdftohtmlCommand().execute({
    command: "pdftohtml", args: carrier.args, argumentValues: carrier, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { async write(chunk: Uint8Array) { stdout.push(chunk.slice()); } },
    stderr: { async write(chunk: Uint8Array) { stderr.push(chunk.slice()); } }
  });
  assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
  const expected = `family="PAXEKO+SourceSansPro${full ? "-Bold" : ""}"`;
  assert.ok(Buffer.concat(stdout).toString().includes(expected));
  const legacy = await runPdftohtmlCli(args, new Map([["/input.pdf", bytes]]));
  assert.equal(legacy.exitCode, 0);
  assert.ok(legacy.stdout.includes(expected));
});
