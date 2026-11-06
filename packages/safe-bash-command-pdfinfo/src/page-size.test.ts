import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createPdfinfoCommand, inspectPdfBytes, runPdfinfoCli } from "./index.js";

for (const flags of [[], ["-box"]]) {
  it(`preserves Poppler page-size precision with ${flags.join(" ") || "default flags"}`, async () => {
    const bytes = await readFile(new URL("../../pdf-ast/src/fixtures/pdfbox-5842-reduced.pdf", import.meta.url));
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in.pdf", bytes);
    let stdout = "", stderr = "";
    const result = await createPdfinfoCommand().execute({
      command: "pdfinfo", args: [...flags, "in.pdf"], cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    });
    for (const output of [
      { ...result, stdout, stderr },
      inspectPdfBytes(bytes, flags),
      await runPdfinfoCli([...flags, "in.pdf"], new Map([["in.pdf", bytes]])),
    ]) {
      assert.equal(output.exitCode, 0);
      assert.equal(output.stderr, "");
      assert.ok(output.stdout.includes("Page size:       790.866 x 1125.35 pts\n"), output.stdout);
      if (flags.includes("-box")) {
        assert.ok(output.stdout.includes("MediaBox:            0.00     0.00   790.87  1125.35\n"), output.stdout);
      }
    }
  });
}
