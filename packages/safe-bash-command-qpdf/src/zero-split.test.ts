import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const path of ["buffered", "sync", "retained"]) {
  for (const option of ["--split-pages=0", "--split-pages=foo", "--split-pages", "--split-pages=2"]) {
    it(`${path}: ${option} preserves native output names and page grouping`, async () => {
      const document = PdfDocument.create();
      for (let width = 101; width <= 105; width++) document.addPage([width, 200]);
      const input = document.save(), args = [option, "in.pdf", "out.pdf"];
      const files = new Map([["in.pdf", input]]);
      if (path === "retained") {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/scratch");
        await fs.writeFile("/in.pdf", input);
        const carrier = createCommandArguments(args);
        const result = await createQpdfCommand().execute({
          command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write() { assert.fail("Unexpected stdout"); } },
          stderr: { async write() { assert.fail("Unexpected stderr"); } }
        });
        assert.equal(result.exitCode, 0);
        for (const entry of await fs.readdir("/")) {
          if (entry.name !== "scratch") files.set(entry.name, await fs.readFile(`/${entry.name}`));
        }
        assert.deepEqual(await fs.readdir("/scratch"), []);
      } else {
        const result = await (path === "sync" ? runQpdfCliSync : runQpdfCli)(args, files);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
      }
      assert.deepEqual(files.get("in.pdf"), input);
      files.delete("in.pdf");
      const expected: [string, number[]][] = option === "--split-pages" ? [
        ["out-1.pdf", [101]], ["out-2.pdf", [102]], ["out-3.pdf", [103]], ["out-4.pdf", [104]], ["out-5.pdf", [105]]
      ] : option === "--split-pages=2" ? [
        ["out-1-2.pdf", [101, 102]], ["out-3-4.pdf", [103, 104]], ["out-5-5.pdf", [105]]
      ] : [["out.pdf", [101, 102, 103, 104, 105]]];
      assert.deepEqual([...files.keys()].sort(), expected.map(([name]) => name).sort());
      for (const [name, widths] of expected) {
        assert.deepEqual(PdfDocument.load(files.get(name)!).getPages().map(page => page.getSize().width), widths);
      }
    });
  }
}
