import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/encryption-reports.json", import.meta.url), "utf8")) as {
  cases: { name: string; pdf: string; reports: Record<string, string> }[];
};
for (const fixture of fixtures.cases) for (const [password, expected] of Object.entries(fixture.reports)) {
  it(`matches native qpdf encryption report for ${fixture.name} with ${password} password on both paths`, async () => {
    const input = new Uint8Array(Buffer.from(fixture.pdf, "base64"));
    const args = [`--password=${password}`, "--show-encryption", "/in.pdf"];
    for (const run of [runQpdfCli, runQpdfCliSync]) {
      const result = await run(args, new Map([["/in.pdf", input]]));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
    const carrier = createCommandArguments(args), output: Uint8Array[] = [], errors: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { output.push(bytes); } }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } } });
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(output).toString(), expected);
    assert.deepEqual(await fs.readFile("/in.pdf"), input);
    assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}
