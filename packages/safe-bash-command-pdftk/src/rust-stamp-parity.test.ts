import {assert, it} from "vitest";
import {PdfDocument} from "@poe-code/pdf-ast";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {createCommandArguments} from "safe-bash-contracts";
import {createPdftkCommand, runPdftkCli} from "./index.js";
import fixtures from "../../../tests/fixtures/media/pdftk-stamp-parity.json" with {type: "json"};

for (const fixture of fixtures) it(`preserves both JavaScript stamp routes: ${fixture.name}`, async () => {
  const input = Uint8Array.from(atob(fixture.input), char => char.charCodeAt(0));
  const stamp = Uint8Array.from(atob(fixture.stamp), char => char.charCodeAt(0));
  const files = new Map([["in", input], ["stamp", stamp]]);
  const buffered = await runPdftkCli(fixture.args, files);
  assert.deepEqual([buffered.exitCode, buffered.stdout, buffered.stderr], [fixture.status, fixture.stdout, fixture.stderr]);
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/in", input); await fs.writeFile("/stamp", stamp);
  let stdout = "", stderr = "";
  const carrier = createCommandArguments(fixture.args);
  const result = await createPdftkCommand().execute({
    command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: {TMPDIR: "/scratch"}, fs,
    signal: new AbortController().signal, stdin: (async function* (): AsyncGenerator<Uint8Array> {})(),
    stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
  });
  assert.deepEqual([result.exitCode, stdout, stderr], [fixture.status, fixture.stdout, fixture.stderr]);
  for (const bytes of [files.get("out")!, await fs.readFile("/out")]) {
    const doc = PdfDocument.load(bytes);
    assert.equal(doc.getPageCount(), fixture.pages);
    assert.equal(new TextDecoder().decode(doc.getPage(0).getRawContentStream()), fixture.content);
  }
  assert.deepEqual(files.get("in"), input); assert.deepEqual(files.get("stamp"), stamp);
  assert.deepEqual(await fs.readFile("/in"), input);
  assert.deepEqual(await fs.readFile("/stamp"), stamp);
  assert.deepEqual([...files.keys()].sort(), ["in", "out", "stamp"]);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["in", "out", "scratch", "stamp"]);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
