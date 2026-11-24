import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {it} from "node:test";
import {PdfDocument} from "@poe-code/pdf-ast";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {createCommandArguments} from "safe-bash-contracts";
import {createQpdfCommand, runQpdfCli} from "./index.js";

interface Report {status: number; stdout: string; stderr: string}
const fixtures = JSON.parse(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/qpdf-catalog-parity.json", import.meta.url), "utf8")) as (Report & {corpus: string; name: string; flags: string; outputPages?: number; replacementPages?: number; buffered?: Report})[];
const sources = Object.fromEntries(["strict-catalogs", "recovered-catalogs"].map(corpus => [corpus,
  JSON.parse(readFileSync(new URL(`../../safe-bash-rust/tests/fixtures/${corpus}.json`, import.meta.url), "utf8")).cases])) as Record<string, Record<string, {pdf: string}>>;
for (const fixture of fixtures) it(`preserves both JavaScript catalog routes: ${fixture.corpus}/${fixture.name}/${fixture.flags}`, async () => {
  const bytes = Buffer.from(sources[fixture.corpus]![fixture.name]!.pdf, "base64");
  const args = ["in.pdf", ...fixture.flags.split(" ")];
  const files = new Map([["in.pdf", bytes], ["out.pdf", new TextEncoder().encode("original")]]);
  const buffered = await runQpdfCli(args, files);
  const bufferedWant = fixture.buffered ?? fixture;
  assert.deepEqual([buffered.exitCode, buffered.stderr, Buffer.from(buffered.stdoutBytes ?? buffered.stdout)],
    [bufferedWant.status, bufferedWant.stderr, Buffer.from(bufferedWant.stdout, "base64")]);
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/in.pdf", bytes);
  await fs.writeFile("/out.pdf", new TextEncoder().encode("original"));
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
  const result = await createQpdfCommand().execute({
    command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: {TMPDIR: "/scratch"}, fs,
    signal: new AbortController().signal, stdin: (async function* (): AsyncGenerator<Uint8Array> {})(),
    stdout: {async write(bytes) {stdout.push(bytes.slice());}},
    stderr: {async write(bytes) {stderr.push(bytes.slice());}}
  });
  assert.deepEqual([result.exitCode, Buffer.concat(stderr).toString(), Buffer.concat(stdout)],
    [fixture.status, fixture.stderr, Buffer.from(fixture.stdout, "base64")]);
  if (fixture.outputPages !== undefined) {
    assert.equal((await PdfDocument.load(await fs.readFile("/out.pdf"))).getPageCount(), fixture.outputPages);
    assert.equal((await PdfDocument.load(files.get("out.pdf")!)).getPageCount(), fixture.outputPages);
  } else {
    assert.deepEqual(await fs.readFile("/out.pdf"), new TextEncoder().encode("original"));
    assert.deepEqual(files.get("out.pdf"), new TextEncoder().encode("original"));
  }
  if (fixture.replacementPages !== undefined) {
    assert.equal((await PdfDocument.load(await fs.readFile("/in.pdf"))).getPageCount(), fixture.replacementPages);
    assert.equal((await PdfDocument.load(files.get("in.pdf")!)).getPageCount(), fixture.replacementPages);
  } else {
    assert.deepEqual(await fs.readFile("/in.pdf"), new Uint8Array(bytes));
    assert.deepEqual(files.get("in.pdf"), bytes);
  }
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
