import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const xrefs: Record<string, string> = JSON.parse(readFileSync(new URL("../../pdf-ast/src/fixtures/qpdf-prefixed-xrefs.json", import.meta.url), "utf8"));

// qpdf 12.4.2 exits 0 without diagnostics for each fixture; a zero startxref
// instead requires reconstruction and exits 3. These are independent controls.
for (const kind of ["table", "stream", "incremental", "unindexed", "linearized"]) {
  for (const prefixed of [false, true]) for (const damaged of [false, true]) for (const inspection of ["--check", "--show-xref", "--json"]) {
    if (damaged && inspection !== "--check") continue;
    it(`${inspection} ${kind}, prefix=${prefixed}, damaged=${damaged} with native warning semantics`, async () => {
      const fixture = readFileSync(new URL(`../../pdf-ast/src/fixtures/qpdf-prefixed-${kind}.pdf`, import.meta.url));
      let bytes = prefixed ? fixture : fixture.subarray(14);
      if (damaged) bytes = Buffer.concat([bytes.subarray(0, bytes.lastIndexOf("startxref")), Buffer.from("startxref\n0\n%%EOF\n")]);
      const args = ["in.pdf", inspection], code = damaged ? 3 : 0;
      const expected = await runQpdfCli(args, new Map([["in.pdf", bytes]]));
      assert.equal(expected.exitCode, code, expected.stderr);
      assert.equal(expected.stderr.includes("reconstructing"), damaged);
      if (!damaged) assert.equal(expected.stderr, "");
      if (inspection !== "--check") {
        const unprefixed = await runQpdfCli(args, new Map([["in.pdf", fixture.subarray(14)]]));
        assert.equal(expected.stdout, unprefixed.stdout);
        if (inspection === "--show-xref") assert.equal(expected.stdout, xrefs[kind]);
      }
      assert.deepEqual(runQpdfCliSync(args, new Map([["in.pdf", bytes]])), expected);
      const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", bytes);
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
      const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier,
        cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
        stdin: (async function* (): AsyncGenerator<Uint8Array> {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } } });
      assert.equal(result.exitCode, code);
      assert.equal(Buffer.concat(stdout).toString(), expected.stdout);
      assert.equal(Buffer.concat(stderr).toString(), expected.stderr);
      assert.deepEqual(Buffer.from(await fs.readFile("/in.pdf")), bytes);
      assert.deepEqual(await fs.readdir("/scratch"), []);
    });
  }
}
