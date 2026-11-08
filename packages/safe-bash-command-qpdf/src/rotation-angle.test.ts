import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const path of ["buffered", "sync", "retained"]) {
  for (const angle of ["45", "-45", "405", "90", "+90", "+180", "-90"]) {
    for (const existing of [false, true]) it(`${path}: rotate ${angle} preserves output on error (existing=${existing})`, async () => {
      const document = PdfDocument.create();
      document.addPage().setRotation(90);
      document.addPage();
      const input = document.save(), original = new TextEncoder().encode("existing output");
      const args = [`--rotate=${angle}:1`, "in.pdf", "out.pdf"];
      const invalid = Number(angle) % 90 !== 0;
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
      assert.equal(result.exitCode, invalid ? 2 : 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, invalid ? `qpdf: invalid parameter to rotate (angle must be a multiple of 90): ${angle}:1\n` : "");
      if (invalid) assert.deepEqual(output, existing ? original : undefined);
      else {
        const rotated = PdfDocument.load(output!);
        const expected = ((Number(angle) + (angle.startsWith("+") || angle.startsWith("-") ? 90 : 0)) % 360 + 360) % 360;
        assert.equal(rotated.getPages()[0]!.getRotation(), expected);
        assert.equal(rotated.getPages()[1]!.getRotation(), 0);
      }
    });
  }
}
