import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createPdfdetachCommand, createPdffontsCommand, runPdffontsCliSync } from "./index.js";

for (const { env, directory } of [
  { env: {}, directory: "/tmp" },
  { env: { TMPDIR: "scratch/nested" }, directory: "/work/scratch/nested" }
]) {
  for (const input of ["/input.pdf", "-"]) {
    for (const command of ["pdffonts", "pdfdetach"]) {
      it(`${command} provisions ${directory} for retained ${input} input`, async () => {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/work");
        const document = PdfDocument.create();
        document.addPage().drawText("Hello", { x: 0, y: 0 });
        const bytes = document.save();
        await fs.writeFile("/input.pdf", bytes);
        await assert.rejects(fs.stat(directory), { code: "ENOENT" });
        const injected = new Proxy(fs, {
          get(target, key) {
            if (key === "readFile") return async () => { throw new Error("whole input read forbidden"); };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          }
        });
        let stdout = "", stderr = "";
        const args = command === "pdffonts" ? [input] : ["-list", input];
        const handler = command === "pdffonts" ? createPdffontsCommand() : createPdfdetachCommand();
        const result = await handler.execute({
          command, args, cwd: "/work", env, fs: injected, signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        const expected = command === "pdffonts"
          ? runPdffontsCliSync(["/input.pdf"], new Map([["/input.pdf", bytes]]))
          : { exitCode: 0, stdout: "0 embedded files\n", stderr: "" };
        assert.deepEqual({ exitCode: result.exitCode, stdout, stderr }, expected);
        assert.deepEqual(await fs.readdir(directory), []);
      });
    }
  }
}
