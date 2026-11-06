import assert from "node:assert/strict";
import { it } from "node:test";
import { readFile } from "node:fs/promises";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const input = await readFile(new URL("./fixtures/compressed-pages.pdf", import.meta.url));
// Parsed native qpdf 12.4.2 output for the same tracked compressed fixture.
const snapshots = JSON.parse(await readFile(new URL("./fixtures/json-decode-level.json", import.meta.url), "utf8"));
for (const level of [undefined, "none", "generalized", "specialized", "all"]) for (const mode of ["none", "inline", "file"]) for (const path of ["sync", "buffered", "retained"]) {
  it(`matches native JSON stream bytes and dictionaries (${level ?? "default"}, ${mode}, ${path})`, async () => {
    const args = ["--json=2", "--json-key=qpdf", "--json-object=7", "--json-object=8", `--json-stream-data=${mode}`, "--json-stream-prefix=stream-", ...(level ? [`--decode-level=${level}`] : []), "in.pdf"];
    const expected = structuredClone(snapshots[`${level === "none" ? "none" : "generalized"}-${mode === "file" ? "inline" : mode}`]);
    expected.parameters.decodelevel = level ?? "generalized";
    const streams = new Map<string, Uint8Array>();
    if (mode === "file") for (const [key, value] of Object.entries(expected.qpdf[1])) {
      const stream = (value as { stream?: { data?: string; datafile?: string } }).stream;
      if (!stream) continue;
      stream.datafile = `stream-${key.slice(4).split(" ")[0]}`;
      streams.set(stream.datafile, Buffer.from(stream.data!, "base64")); delete stream.data;
    }
    if (path === "retained") {
      const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
        stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
      assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
      assert.deepEqual(JSON.parse(Buffer.concat(stdout).toString()), expected);
      for (const [name, bytes] of streams) assert.deepEqual(Buffer.from(await fs.readFile(`/${name}`)), Buffer.from(bytes));
      assert.deepEqual(await fs.readdir("/scratch"), []);
    } else {
      const files = new Map<string, Uint8Array>([["in.pdf", input]]);
      const result = path === "sync" ? runQpdfCliSync(args, files) : await runQpdfCli(args, files);
      assert.equal(result.exitCode, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), expected);
      for (const [name, bytes] of streams) assert.deepEqual(Buffer.from(files.get(name)!), Buffer.from(bytes));
    }
  });
}
