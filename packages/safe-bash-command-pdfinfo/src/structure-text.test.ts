import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createPdfinfoCommand, runPdfinfoCli } from "./index.js";

for (const retained of [false, true]) {
  it(`preserves trailing structure text spaces through the ${retained ? "retained command" : "buffered API"}`, async () => {
    const bytes = await readFile(new URL("../../pdf-ast/src/fixtures/pdfjs-issue17069.pdf", import.meta.url));
    const args = ["-struct-text", "in.pdf"];
    let stdout = "", stderr = "", exitCode: number;
    if (retained) {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/in.pdf", bytes);
      const result = await createPdfinfoCommand().execute({
        command: "pdfinfo", args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
      });
      exitCode = result.exitCode;
    } else {
      ({ stdout, stderr, exitCode } = await runPdfinfoCli(args, new Map([["in.pdf", bytes]])));
    }
    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    const payloads = stdout.split("\n").map(line => line.trimStart())
      .filter(line => line.startsWith('"')).map(line => line.slice(1, -1));
    // Poppler 26.08.0 emits this payload; indentation and role labels are independent.
    assert.deepEqual(payloads, ["Test doc "]);
  });
}
