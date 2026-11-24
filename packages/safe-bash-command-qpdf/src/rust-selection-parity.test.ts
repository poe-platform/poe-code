import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {it} from "node:test";
import {PdfDocument} from "@poe-code/pdf-ast";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {createCommandArguments} from "safe-bash-contracts";
import {createQpdfCommand, runQpdfCli} from "./index.js";

interface Report {status: number; stdout: string; stderr: string}
const fixtures = JSON.parse(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/qpdf-selection-parity.json", import.meta.url), "utf8")) as (Report & {name: string; pdf: string; defaultPages: number; outputPages?: number; args: string[]; buffered?: Report})[];

for (const fixture of fixtures) it(`preserves both JavaScript trailer selection routes: ${fixture.name}/${fixture.args.join(" ")}`, async () => {
  const bytes = Buffer.from(fixture.pdf, "base64");
  assert.equal((await PdfDocument.load(bytes, {recovery: "repair"})).getPageCount(), fixture.defaultPages);
  const args = fixture.args;
  const expected = [fixture.status, fixture.stderr, Buffer.from(fixture.stdout, "base64")];
  const files = new Map([["in.pdf", bytes], ["out.pdf", new TextEncoder().encode("KEEP")]]);
  const buffered = await runQpdfCli(args, files);
  const bufferedWant = fixture.buffered ?? fixture;
  assert.deepEqual([buffered.exitCode, buffered.stderr, Buffer.from(buffered.stdoutBytes ?? buffered.stdout)],
    [bufferedWant.status, bufferedWant.stderr, Buffer.from(bufferedWant.stdout, "base64")]);
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/in.pdf", bytes);
  await fs.writeFile("/out.pdf", new TextEncoder().encode("KEEP"));
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
  const result = await createQpdfCommand().execute({
    command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: {TMPDIR: "/scratch"}, fs,
    signal: new AbortController().signal, stdin: (async function* (): AsyncGenerator<Uint8Array> {})(),
    stdout: {async write(bytes) {stdout.push(bytes.slice());}},
    stderr: {async write(bytes) {stderr.push(bytes.slice());}}
  });
  assert.deepEqual([result.exitCode, Buffer.concat(stderr).toString(), Buffer.concat(stdout)], expected);
  assert.deepEqual(await fs.readFile("/in.pdf"), new Uint8Array(bytes));
  assert.deepEqual(files.get("in.pdf"), bytes);
  if (fixture.outputPages !== undefined) {
    assert.equal((await PdfDocument.load(await fs.readFile("/out.pdf"))).getPageCount(), fixture.outputPages);
    assert.equal((await PdfDocument.load(files.get("out.pdf")!)).getPageCount(), fixture.outputPages);
  }
  if (fixture.status === 2) {
    assert.deepEqual(files.get("out.pdf"), new TextEncoder().encode("KEEP"));
    assert.deepEqual(await fs.readFile("/out.pdf"), new TextEncoder().encode("KEEP"));
  }
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
