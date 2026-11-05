import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const input = readFileSync(new URL("../../pdf-ast/src/fixtures/qpdf-shared-images.pdf", import.meta.url));

for (const path of ["buffered", "sync", "retained"]) {
  for (const group of [1, 2, 3]) {
    it(`${path}: linearizes every split output for groups of ${group}`, async () => {
      const files = new Map<string, Uint8Array>([["in.pdf", input]]);
      const args = ["in.pdf", `--split-pages=${group}`, "--linearize", "out.pdf"];
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
      const names = [];
      for (let start = 1; start <= 10; start += group) {
        const end = Math.min(10, start + group - 1);
        const range = group === 1 ? String(start).padStart(2, "0") : `${String(start).padStart(2, "0")}-${String(end).padStart(2, "0")}`;
        const name = `out-${range}.pdf`;
        names.push(name);
        const bytes = files.get(name)!;
        assert.equal(PdfDocument.load(bytes).getPageCount(), end - start + 1);
        assert.deepEqual(await runQpdfCli([name, "--check-linearization"], files), {
          exitCode: 0, stdout: `${name}: no linearization errors\n`, stderr: ""
        });
      }
      assert.deepEqual([...files.keys()].sort(), ["in.pdf", ...names].sort());
      assert.deepEqual(Buffer.from(files.get("in.pdf")!), input);
    });
  }
}
