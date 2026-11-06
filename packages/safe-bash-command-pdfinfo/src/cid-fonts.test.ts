import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createPdffontsCommand, runPdffontsCli, runPdffontsCliSync } from "./index.js";

for (const [fixture, row] of [
  ["pdfjs-cff_bluescale_small_zones", "PCJENN+SofiaPro-Regular              CID Type 0C       Identity-H       yes yes no       5  0"],
  ["pdfjs-cid_cff", "ERGTBC+NeoSansIntel                  CID Type 0C       Identity-H       yes yes yes      7  0"],
  ["pdfjs-issue17069", "PGBVXH+CourierStd                    CID Type 0C       Identity-H       yes yes yes     70  0"],
  ["pdfjs-text_clip_cff_cid", "XTQOSZ+Reitam-Identity-H             CID Type 0C       Identity-H       yes yes yes      5  0"],
  ["pdfbox-6077-example", undefined],
] as const) {
  for (const path of ["public", "buffered", "sync"]) {
    it(`matches native font inspection for ${fixture} through ${path}`, async () => {
      const bytes = await readFile(new URL(`../../pdf-ast/src/fixtures/${fixture}.pdf`, import.meta.url));
      const args = ["in.pdf"];
      const files = new Map([["in.pdf", bytes]]);
      let output;
      if (path === "public") {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/tmp");
        await fs.writeFile("/in.pdf", bytes);
        let stdout = "", stderr = "";
        const result = await createPdffontsCommand().execute({
          command: "pdffonts", args, cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() {} },
          stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        });
        output = { ...result, stdout, stderr };
      } else {
        output = path === "sync" ? runPdffontsCliSync(args, files) : await runPdffontsCli(args, files);
      }
      assert.equal(output.exitCode, 0);
      assert.equal(output.stderr, "");
      if (row) assert.ok(output.stdout.split("\n").includes(row), output.stdout);
      if (fixture === "pdfbox-6077-example") assert.equal(output.stdout.trimEnd().split("\n").length, 2);
      if (fixture === "pdfjs-issue17069") {
        assert.equal(output.stdout.trimEnd().split("\n").length, 7);
        assert.ok(output.stdout.includes("YQNXTZ+ArialMT                       CID TrueType"), output.stdout);
      }
    });
  }
}
