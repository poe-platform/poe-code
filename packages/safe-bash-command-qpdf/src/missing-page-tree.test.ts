import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const input = readFileSync(new URL("../../pdf-ast/src/fixtures/pdfjs-issue9418.pdf", import.meta.url));
for (const args of [["--show-npages", "in.pdf"], ["--check", "in.pdf"], ["in.pdf", "-"], ["in.pdf", "out.pdf"], ["in.pdf", "--replace-input"]]) {
  for (const path of ["async", "sync", "retained"]) it(`rejects a missing page tree: ${path} ${args.join(" ")}`, async () => {
    if (path === "retained") {
      const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
      const stderr: Uint8Array[] = [], stdout: Uint8Array[] = [];
      const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
      assert.equal(result.exitCode, 2);
      assert.ok(Buffer.concat(stderr).toString().includes("unable to find page tree"));
      assert.equal(Buffer.concat(stdout).length, 0);
      assert.deepEqual(await fs.readFile("/in.pdf"), new Uint8Array(input));
      await assert.rejects(fs.stat("/out.pdf"), { code: "ENOENT" });
      assert.deepEqual(await fs.readdir("/scratch"), []);
    } else {
      const files = new Map<string, Uint8Array>([["in.pdf", input]]);
      const result = await (path === "sync" ? runQpdfCliSync : runQpdfCli)(args, files);
      assert.equal(result.exitCode, 2);
      assert.ok(result.stderr.includes("unable to find page tree"));
      assert.equal(result.stdout, "");
      assert.equal(result.stdoutBytes?.length ?? 0, 0);
      assert.deepEqual([...files.keys()], ["in.pdf"]);
      assert.equal(files.get("in.pdf"), input);
    }
  });
}
