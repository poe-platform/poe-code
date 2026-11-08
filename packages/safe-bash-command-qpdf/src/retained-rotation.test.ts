import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand } from "./index.js";

for (const [rotation, expected] of [["+90:2-3", [0, 180, 90]], ["0:2", [0, 0, 0]]] as const) {
  for (const mode of ["preserve", "disable", "generate"]) it(`rotates compressed pages by ${rotation} with object streams ${mode}`, async () => {
    const input = await readFile(new URL("./fixtures/compressed-pages.pdf", import.meta.url));
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    await fs.writeFile("/in.pdf", input);
    const carrier = createCommandArguments([`--rotate=${rotation}`, `--object-streams=${mode}`, "in.pdf", "out.pdf"]);
    const stderr: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
      stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } } });
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.concat(stderr).toString(), "");
    const output = await PDFDocument.load(await fs.readFile("/out.pdf"));
    assert.deepEqual(output.getPages().map(page => page.getRotation().angle), expected);
    assert.deepEqual(output.getPages().map(page => [page.getWidth(), page.getHeight()]), [[200, 100], [220, 110], [240, 120]]);
    assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}
