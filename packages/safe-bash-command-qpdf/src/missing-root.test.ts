import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const input = readFileSync(new URL("../../pdf-ast/src/fixtures/pdfjs-issue18986.pdf", import.meta.url));
for (const args of [["--show-npages", "in.pdf"], ["--check", "in.pdf"], ["in.pdf", "out.pdf"], ["in.pdf", "-"], ["--warning-exit-0", "--check", "in.pdf"], ["--replace-input", "in.pdf"]]) {
  it(`rejects an unavailable cross-reference root: ${args.join(" ")}`, async () => {
    for (const run of [runQpdfCli, runQpdfCliSync]) {
      const files = new Map<string, Uint8Array>([["in.pdf", input]]);
      const result = await run(args, files);
      assert.equal(result.exitCode, 2, result.stderr);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes("unable to find /Root dictionary"), result.stderr);
      assert.deepEqual([...files.keys()], ["in.pdf"]);
      assert.deepEqual(files.get("in.pdf"), input);
    }
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    await fs.writeFile("/in.pdf", input);
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
    assert.equal(result.exitCode, 2, Buffer.concat(stderr).toString());
    assert.equal(Buffer.concat(stdout).length, 0);
    assert.ok(Buffer.concat(stderr).toString().includes("unable to find /Root dictionary"));
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["in.pdf", "scratch"]);
    assert.deepEqual(await fs.readFile("/in.pdf"), new Uint8Array(input));
    assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}
