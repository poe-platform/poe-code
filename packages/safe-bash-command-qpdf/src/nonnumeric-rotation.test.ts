import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const path of ["buffered", "sync", "retained"]) {
  for (const [angle, expected] of [["foo", 0], ["+foo", 90], ["-foo", 90], ["", 0], ["90foo", 90], ["+90", 180]] as const) {
    for (const existing of [false, true]) it(`${path}: rotate ${angle} matches native zero fallback (existing=${existing})`, async () => {
      const document = PdfDocument.create();
      document.addPage().setRotation(90);
      document.addPage();
      const input = document.save(), original = new TextEncoder().encode("existing output");
      const args = [`--rotate=${angle}:1`, "in.pdf", "out.pdf"];
      let output: Uint8Array | undefined;
      let result: { exitCode: number; stdout: string; stderr: string };
      if (path === "retained") {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/scratch");
        await fs.writeFile("/in.pdf", input);
        if (existing) await fs.writeFile("/out.pdf", original);
        const carrier = createCommandArguments(args), errors: Uint8Array[] = [], stdout: Uint8Array[] = [];
        const execution = await createQpdfCommand().execute({
          command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes.slice()); } }
        });
        result = { exitCode: execution.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(errors).toString() };
        if ((await fs.readdir("/")).some(entry => entry.name === "out.pdf")) output = await fs.readFile("/out.pdf");
        assert.deepEqual(await fs.readFile("/in.pdf"), input);
        assert.deepEqual(await fs.readdir("/scratch"), []);
      } else {
        const files = new Map([["in.pdf", input]]);
        if (existing) files.set("out.pdf", original);
        result = await (path === "sync" ? runQpdfCliSync : runQpdfCli)(args, files);
        output = files.get("out.pdf");
        assert.deepEqual(files.get("in.pdf"), input);
      }
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      const rotated = PdfDocument.load(output!);
      assert.equal(rotated.getPageCount(), 2);
      assert.equal(rotated.getPages()[0]!.getRotation(), expected);
      assert.equal(rotated.getPages()[1]!.getRotation(), 0);
    });
  }
}
