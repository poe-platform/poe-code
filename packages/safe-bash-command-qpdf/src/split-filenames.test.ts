import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const path of ["buffered", "sync", "retained"]) {
  for (const [target, names] of [
    ["out-%02d.pdf", ["out-%02d-1-2.pdf", "out-%02d-3-4.pdf", "out-%02d-5-5.pdf"]],
    ["out-%%d.pdf", ["out-%1-2.pdf", "out-%3-4.pdf", "out-%5-5.pdf"]],
    ["out-%d.pdf", ["out-1-2.pdf", "out-3-4.pdf", "out-5-5.pdf"]],
    ["out-%%-%d-%d.pdf", ["out-%%-1-2-%d.pdf", "out-%%-3-4-%d.pdf", "out-%%-5-5-%d.pdf"]]
  ] as const) {
    it(`${path}: splits ${target} using native literal percent-d substitution`, async () => {
      const document = PdfDocument.create();
      for (let width = 101; width <= 105; width++) document.addPage([width, 200]);
      const input = document.save(), files = new Map([["in.pdf", input]]);
      const args = ["--split-pages=2", "in.pdf", target];
      if (path === "retained") {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/scratch");
        await fs.writeFile("/in.pdf", input);
        const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
        const result = await createQpdfCommand().execute({
          command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write() { assert.fail("Unexpected stdout"); } },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        });
        assert.equal(result.exitCode, 0);
        assert.equal(Buffer.concat(errors).toString(), "");
        files.clear();
        for (const entry of await fs.readdir("/")) {
          if (entry.name !== "scratch") files.set(entry.name, await fs.readFile(`/${entry.name}`));
        }
        assert.deepEqual(await fs.readdir("/scratch"), []);
      } else {
        const result = await (path === "sync" ? runQpdfCliSync : runQpdfCli)(args, files);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
      }
      assert.deepEqual([...files.keys()].sort(), ["in.pdf", ...names].sort());
      assert.deepEqual(files.get("in.pdf"), input);
      for (const [index, name] of names.entries()) {
        assert.deepEqual(PdfDocument.load(files.get(name)!).getPages().map(page => page.getSize().width),
          index === 2 ? [105] : [101 + index * 2, 102 + index * 2]);
      }
    });
  }
}
