import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {it} from "node:test";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {createCommandArguments} from "safe-bash-contracts";
import {createQpdfCommand, runQpdfCli} from "./index.js";

interface Report {status: number; stdout: string; stderr: string}
const fixtures = JSON.parse(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/qpdf-trailer-parity.json", import.meta.url), "utf8")) as (Report & {corpus: string; name: string; flags: string; buffered?: Report})[];

for (const fixture of fixtures) it(`preserves both JavaScript trailer routes: ${fixture.corpus}/${fixture.name}`, async () => {
  const {cases} = JSON.parse(readFileSync(new URL(`../../safe-bash-rust/tests/fixtures/${fixture.corpus}.json`, import.meta.url), "utf8")) as {cases: Record<string, {pdf: string}>};
  const bytes = Buffer.from(cases[fixture.name]!.pdf, "base64");
  const args = ["in.pdf", ...fixture.flags.split(" ")];
  const expected = [fixture.status, fixture.stderr, Buffer.from(fixture.stdout, "base64")];
  const buffered = await runQpdfCli(args, new Map([["in.pdf", bytes]]));
  const bufferedWant = fixture.buffered ?? fixture;
  assert.deepEqual([buffered.exitCode, buffered.stderr, Buffer.from(buffered.stdoutBytes ?? buffered.stdout)],
    [bufferedWant.status, bufferedWant.stderr, Buffer.from(bufferedWant.stdout, "base64")]);
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/in.pdf", bytes);
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
  const result = await createQpdfCommand().execute({
    command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: {TMPDIR: "/scratch"}, fs,
    signal: new AbortController().signal, stdin: (async function* (): AsyncGenerator<Uint8Array> {})(),
    stdout: {async write(bytes) {stdout.push(bytes.slice());}},
    stderr: {async write(bytes) {stderr.push(bytes.slice());}}
  });
  assert.deepEqual([result.exitCode, Buffer.concat(stderr).toString(), Buffer.concat(stdout)], expected);
  assert.deepEqual(await fs.readFile("/in.pdf"), new Uint8Array(bytes));
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
