import { test } from "node:test";
import assert from "node:assert/strict";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdfinfoCommand, createPdffontsCommand, createPdfuniteCommand, createPdfseparateCommand } from "./index.js";

for (const entry of [
  { title: "only budgets source bytes: Pdfinfo in.pdf", args: ["in.pdf"], create: createPdfinfoCommand, stdin: false },
  { title: "only budgets source bytes: Pdfinfo -", args: ["-"], create: createPdfinfoCommand, stdin: true },
  { title: "only budgets source bytes: Pdffonts in.pdf", args: ["in.pdf"], create: createPdffontsCommand, stdin: false },
  { title: "only budgets source bytes: Pdffonts -", args: ["-"], create: createPdffontsCommand, stdin: true },
  { title: "only budgets source bytes: Pdfunite in.pdf out.pdf", args: ["in.pdf", "in.pdf", "out.pdf"], create: createPdfuniteCommand, stdin: false },
  { title: "only budgets source bytes: Pdfseparate in.pdf out-%d.pdf", args: ["in.pdf", "out-%d.pdf"], create: createPdfseparateCommand, stdin: false },
]) {
  test(entry.title, async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([8, 8]);
    page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 8, height: 8 });
    const input = doc.save();
    const fs = createMemoryFileSystem();
    await fs.mkdir("/tmp");
    await fs.writeFile("/in.pdf", input);
    for (const path of ["/out.pdf", "/out.txt", "/out.html", "/out", "/out-%d.pdf"]) {
      await fs.writeFile(path, new Uint8Array(input.byteLength * 2));
    }
    const args = createCommandArguments(entry.args);
    const command = entry.create({ limits: { maxInputBytes: input.byteLength } });
    const result = await command.execute({
      command: command.name, args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
      stdin: (async function* () { if (entry.stdin) yield input; })(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    });
    assert.equal(result.exitCode, 0);
  });
}
