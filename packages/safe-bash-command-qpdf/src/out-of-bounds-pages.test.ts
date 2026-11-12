import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { readFileSync } from "node:fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const [spec, marked, number] of [
  ["0", "*0", 0], ["4", "*4", 4], ["r0", "*r0", 4], ["r4", "*r4", 0],
  ["1-4", "*1-4", 4], ["r4-1", "*r4-1", 0], ["1-z,x4", "1-z,*x4", 4],
] as const) {
  const diagnostic = `parsing numeric range for in.pdf: error at * in numeric range ${marked}: number ${number} out of range`;
  for (const existing of [false, true]) it(`rejects out-of-bounds page range ${spec} without publishing output (existing=${existing})`, async () => {
    const input = new Uint8Array(readFileSync(new URL("./fixtures/compressed-pages.pdf", import.meta.url))), original = new TextEncoder().encode("existing output");
    const args = ["--empty", "--pages", "in.pdf", spec, "--", "out.pdf"];
    for (const run of [runQpdfCli, runQpdfCliSync]) {
      const files = new Map([["in.pdf", input]]);
      if (existing) files.set("out.pdf", original);
      const result = await run(args, files);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stderr, `qpdf: ${diagnostic}\n`);
      assert.equal(result.stdout, "");
      assert.deepEqual(files.get("out.pdf"), existing ? original : undefined);
      assert.deepEqual(files.get("in.pdf"), input);
    }
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
    if (existing) await fs.writeFile("/out.pdf", original);
    const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write() { assert.fail("unexpected stdout"); } }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } } });
    assert.equal(result.exitCode, 2);
    assert.equal(Buffer.concat(errors).toString(), `qpdf: ${diagnostic}\n`);
    if (existing) assert.deepEqual(await fs.readFile("/out.pdf"), original);
    else await assert.rejects(fs.stat("/out.pdf"), { code: "ENOENT" });
    assert.deepEqual(await fs.readFile("/in.pdf"), input);
    assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}
