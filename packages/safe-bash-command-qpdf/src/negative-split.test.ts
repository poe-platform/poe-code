import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const path of ["buffered", "sync", "retained"]) {
  for (const group of [-1, -2, 1]) {
    it(`${path}: split group ${group} rejects negatives without changing files and preserves positive grouping`, async () => {
      const document = PdfDocument.create();
      for (let width = 101; width <= 105; width++) document.addPage([width, 200]);
      const input = document.save();
      const original = new TextEncoder().encode("existing output");
      const files = new Map([["in.pdf", input], ["out.pdf", original], ["out-1.pdf", original]]);
      const before = new Map(files);
      const args = [`--split-pages=${group}`, "in.pdf", "out.pdf"];
      const diagnostic = group < 0 ? `qpdf: integer out of range converting ${group} from a 4-byte signed type to a 8-byte unsigned type\n` : "";
      if (path === "retained") {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/scratch");
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
        const result = await createQpdfCommand().execute({
          command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write() { assert.fail("Unexpected stdout"); } },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        });
        assert.equal(result.exitCode, group < 0 ? 2 : 0);
        assert.equal(Buffer.concat(errors).toString(), diagnostic);
        files.clear();
        for (const entry of await fs.readdir("/")) {
          if (entry.name !== "scratch") files.set(entry.name, await fs.readFile(`/${entry.name}`));
        }
        assert.deepEqual(await fs.readdir("/scratch"), []);
      } else {
        const result = await (path === "sync" ? runQpdfCliSync : runQpdfCli)(args, files);
        assert.equal(result.exitCode, group < 0 ? 2 : 0);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, diagnostic);
      }
      if (group < 0) assert.deepEqual(files, before);
      else {
        assert.equal(files.size, 7);
        assert.deepEqual(files.get("in.pdf"), input);
        assert.deepEqual(files.get("out.pdf"), original);
        for (let page = 1; page <= 5; page++) {
          assert.deepEqual(PdfDocument.load(files.get(`out-${page}.pdf`)!).getPages().map(p => p.getSize().width), [100 + page]);
        }
      }
    });
  }
}
