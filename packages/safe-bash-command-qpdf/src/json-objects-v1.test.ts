import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const input = readFileSync(new URL("./fixtures/compressed-pages.pdf", import.meta.url));
// Native qpdf 12.4.2 --json=1 --json-key=objects.
const expected = JSON.parse(readFileSync(new URL("./fixtures/compressed-pages.objects-v1.json", import.meta.url), "utf8")).objects;

for (const path of ["sync", "buffered", "streaming"]) for (const mode of ["selected", "default", "selectors", "inline", "file"]) {
  it(`emits native version 1 objects (${path}, ${mode})`, async () => {
    const args = ["--json=1", ...(mode === "default" ? [] : ["--json-key=objects"]),
      ...(mode === "selectors" ? ["--json-object=1", "--json-object=7", "--json-object=trailer"] : []),
      ...(mode === "inline" || mode === "file" ? [`--json-stream-data=${mode}`, "--json-stream-prefix=stream-"] : []), "in.pdf"];
    let stdout: string;
    if (path === "streaming") {
      const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
      const chunks: Uint8Array[] = [];
      const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
        stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write() {} } });
      assert.equal(result.exitCode, 0);
      stdout = Buffer.concat(chunks).toString();
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["in.pdf", "scratch"]);
      assert.deepEqual(await fs.readdir("/scratch"), []);
    } else {
      const files = new Map([["in.pdf", input]]);
      const result = path === "sync" ? runQpdfCliSync(args, files) : await runQpdfCli(args, files);
      assert.equal(result.exitCode, 0, result.stderr); stdout = result.stdout;
      assert.equal(files.size, 1);
    }
    assert.deepEqual(JSON.parse(stdout).objects, mode === "selectors"
      ? Object.fromEntries(["1 0 R", "7 0 R", "trailer"].map(key => [key, expected[key]])) : expected);
  });
}
