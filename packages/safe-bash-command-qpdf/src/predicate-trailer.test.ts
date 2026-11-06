import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosName, cosDict, cosStream, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const location of ["page", "content"]) for (const flag of ["--is-encrypted", "--requires-password"]) {
  it(`ignores /Encrypt in ${location} for ${flag}`, async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage();
    if (location === "page") dictSet(page.dict, "Encrypt", cosName("marker"));
    else dictSet(page.dict, "Contents", doc.cos.allocateObject(cosStream(cosDict({}), new TextEncoder().encode("% /Encrypt\n"))));
    const input = doc.save();
    assert.ok(new TextDecoder().decode(input).includes("/Encrypt"));
    const args = [flag, "/in.pdf"];
    const expected = { exitCode: 2, stdout: "", stderr: "" };
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    await fs.writeFile("/in.pdf", input);
    const carrier = createCommandArguments(args), stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
      stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } } });
    assert.equal(result.exitCode, expected.exitCode);
    assert.equal(Buffer.concat(stdout).toString(), expected.stdout);
    assert.equal(Buffer.concat(stderr).toString(), expected.stderr);
    assert.deepEqual(await fs.readFile("/in.pdf"), input);
    assert.deepEqual(await fs.readdir("/scratch"), []);
    for (const run of [runQpdfCli, runQpdfCliSync]) {
      assert.deepEqual(await run(args, new Map([["/in.pdf", input]])), expected);
    }
  });
}
