import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {it} from "node:test";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {createCommandArguments} from "safe-bash-contracts";
import {createPdfinfoCommand, runPdfinfoCli} from "./index.js";

interface Report {status: number; stdout: string; stderr: string; commandError?: {name: string; code: string; message: string}; bufferedError?: {name: string; code: string; message: string}}
const fixtures = JSON.parse(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/pdfinfo-meta-parity.json", import.meta.url), "utf8")) as (Report & {name: string; pdf: string; args: string[];})[];

for (const fixture of fixtures) it(`preserves both JavaScript metadata routes: ${fixture.name}/${fixture.args.join(" ")}`, async () => {
  const bytes = Buffer.from(fixture.pdf, "base64");
  const args = fixture.args;
  const expected = [fixture.status, fixture.stderr, Buffer.from(fixture.stdout, "base64")];
  const files = new Map([["in.pdf", bytes]]);
  if (fixture.bufferedError) await assert.rejects(runPdfinfoCli(args, files), fixture.bufferedError);
  else {
    const buffered = await runPdfinfoCli(args, files);
    assert.deepEqual([buffered.exitCode, buffered.stderr, Buffer.from(buffered.stdout)], expected);
  }
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/in.pdf", bytes);
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
  const execution = createPdfinfoCommand().execute({
    command: "pdfinfo", args: carrier.args, argumentValues: carrier, cwd: "/", env: {TMPDIR: "/scratch"}, fs,
    signal: new AbortController().signal, stdin: (async function* (): AsyncGenerator<Uint8Array> {})(),
    stdout: {async write(bytes) {stdout.push(bytes.slice());}},
    stderr: {async write(bytes) {stderr.push(bytes.slice());}}
  });
  if (fixture.commandError) {
    await assert.rejects(async () => execution, fixture.commandError);
    assert.deepEqual([Buffer.concat(stderr).length, Buffer.concat(stdout).length], [0, 0]);
  } else {
    const result = await execution;
    assert.deepEqual([result.exitCode, Buffer.concat(stderr).toString(), Buffer.concat(stdout)], expected);
  }
  assert.deepEqual(await fs.readFile("/in.pdf"), new Uint8Array(bytes));
  assert.deepEqual(files.get("in.pdf"), bytes);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
