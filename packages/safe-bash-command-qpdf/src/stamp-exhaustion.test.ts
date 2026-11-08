import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const input = readFileSync(new URL("./fixtures/linearized.pdf", import.meta.url));

for (const path of ["buffered", "sync", "retained"]) for (const mode of ["overlay", "underlay"]) {
  for (const repeat of [false, true]) it(`${path}: ${mode} only repeats selected pages with --repeat=${repeat}`, async () => {
    const args = ["in.pdf", "out.pdf", `--${mode}`, "in.pdf", "--from=1", ...(repeat ? ["--repeat=1"] : []), "--"];
    let output: Uint8Array;
    if (path === "retained") {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
      const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
      const result = await createQpdfCommand().execute({
        command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes.slice()); } }
      });
      assert.equal(result.exitCode, 0); assert.equal(Buffer.concat(errors).toString(), "");
      output = await fs.readFile("/out.pdf");
      assert.deepEqual(await fs.readdir("/scratch"), []);
    } else {
      const files = new Map<string, Uint8Array>([["in.pdf", input]]);
      const result = await (path === "sync" ? runQpdfCliSync : runQpdfCli)(args, files);
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
      output = files.get("out.pdf")!;
    }
    const original = PdfDocument.load(input), stamped = PdfDocument.load(output);
    assert.equal(stamped.getPageCount(), 3);
    assert.notDeepEqual(stamped.getPage(0).getRawContentStream(), original.getPage(0).getRawContentStream());
    // Native qpdf 12.4.2 leaves pages 2 and 3 untouched without --repeat.
    for (const index of [1, 2]) {
      if (repeat) assert.ok(stamped.getPage(index).extractText().includes("0"));
      else assert.deepEqual(stamped.getPage(index).getRawContentStream(), original.getPage(index).getRawContentStream());
    }
  });
}
