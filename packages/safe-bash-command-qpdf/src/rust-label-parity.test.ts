import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {it} from "node:test";
import {PdfDocument} from "@poe-code/pdf-ast";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {createCommandArguments} from "safe-bash-contracts";
import {createQpdfCommand, runQpdfCli} from "./index.js";

interface Fixture {
  args: string[];
  status: number;
  stdout: string;
  stderr: string;
  outputs: Record<string, {pages: number; labels: unknown[]}>;
}
const fixtures = JSON.parse(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/qpdf-label-parity.json", import.meta.url), "utf8")) as {pdf: string; cases: Fixture[]};
for (const fixture of fixtures.cases) it(`preserves both JavaScript page-label routes: ${fixture.args.join(" ")}`, async () => {
  const bytes = Buffer.from(fixtures.pdf, "base64");
  const files = new Map<string, Uint8Array>([["in.pdf", bytes], ["out.pdf", Buffer.from("KEEP")]]);
  const buffered = await runQpdfCli(fixture.args, files);
  assert.deepEqual([buffered.exitCode, buffered.stdout, buffered.stderr], [fixture.status, fixture.stdout, fixture.stderr]);
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/in.pdf", bytes);
  await fs.writeFile("/out.pdf", Buffer.from("KEEP"));
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(fixture.args);
  const result = await createQpdfCommand().execute({
    command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: {TMPDIR: "/scratch"}, fs,
    signal: new AbortController().signal, stdin: (async function* (): AsyncGenerator<Uint8Array> {})(),
    stdout: {async write(bytes) {stdout.push(bytes.slice());}},
    stderr: {async write(bytes) {stderr.push(bytes.slice());}}
  });
  assert.deepEqual([result.exitCode, Buffer.concat(stdout).toString(), Buffer.concat(stderr).toString()],
    [fixture.status, fixture.stdout, fixture.stderr]);
  const streamed = new Map(await Promise.all((await fs.readdir("/")).filter(entry => entry.name !== "scratch")
    .map(async entry => [entry.name, await fs.readFile("/" + entry.name)] as const)));
  for (const output of [files, streamed]) {
    assert.deepEqual([...output.keys()].sort(), [...new Set(["in.pdf", "out.pdf", ...Object.keys(fixture.outputs)])].sort());
    if (fixture.status !== 0 || !fixture.args.includes("--replace-input")) assert.deepEqual(Buffer.from(output.get("in.pdf")!), bytes);
    if (!fixture.outputs["out.pdf"]) assert.equal(Buffer.from(output.get("out.pdf")!).toString(), "KEEP");
    for (const [name, expected] of Object.entries(fixture.outputs)) {
      assert.equal(PdfDocument.load(output.get(name)!).getPageCount(), expected.pages);
      const report = await runQpdfCli([name, "--json", "--json-key=pagelabels"], output);
      assert.deepEqual([report.exitCode, report.stderr], [0, ""]);
      assert.deepEqual(JSON.parse(report.stdout).pagelabels, expected.labels);
    }
  }
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
