import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createPdfinfoCommand, inspectPdfBytes, runPdfinfoCli } from "./index.js";

for (const kind of ["table", "stream", "incremental", "unindexed", "linearized"]) {
  it(`reads the indexed page size from a prefixed ${kind} PDF`, async () => {
    const fixture = readFileSync(new URL(`../../pdf-ast/src/fixtures/qpdf-prefixed-${kind}.pdf`, import.meta.url));
    for (const bytes of [fixture, fixture.subarray(14)]) {
      const fs = createMemoryFileSystem(); await fs.writeFile("/in.pdf", bytes);
      let stdout = "", stderr = "";
      const result = await createPdfinfoCommand().execute({
        command: "pdfinfo", args: ["in.pdf"], cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
      });
      for (const output of [{ ...result, stdout, stderr }, inspectPdfBytes(bytes),
        await runPdfinfoCli(["in.pdf"], new Map([["in.pdf", bytes]]))]) {
        assert.equal(output.exitCode, 0, output.stderr); assert.equal(output.stderr, "");
        assert.match(output.stdout, kind === "incremental" ? /Page size:\s+222 x 333 pts/ : /Page size:\s+10 x 20 pts/);
      }
      assert.deepEqual(Buffer.from(await fs.readFile("/in.pdf")), bytes);
    }
  });
}
