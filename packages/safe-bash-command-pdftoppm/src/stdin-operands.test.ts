import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { expect, it } from "vitest";
import { PdfDocument, decodePng } from "@poe-code/pdf-ast";
import type { CommandContext } from "safe-bash-contracts";
import { createPdftoppmCommand, createPdftocairoCommand } from "./index.js";

const doc = PdfDocument.create();
doc.addPage([8, 8]);
const pdf = doc.save();

for (const create of [createPdftoppmCommand, createPdftocairoCommand]) {
  for (const operand of [[], ["-"]]) {
    it(`${create().name} renders ${operand.length ? "explicit" : "implicit"} stdin`, async () => {
      let reads = 0;
      const output: Uint8Array[] = [];
      const context = {
        args: ["-png", "-singlefile", "-r", "72", ...operand],
        cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { reads++; yield pdf; } },
        fs: createMemoryFileSystem(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write() {} },
      } as unknown as CommandContext;
      expect((await create().execute(context)).exitCode).toBe(0);
      expect(reads).toBe(1);
      const png = decodePng(Buffer.concat(output));
      expect([png.width, png.height]).toEqual([8, 8]);
    });
  }
}
