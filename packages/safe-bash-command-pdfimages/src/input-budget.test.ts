import { test, expect } from "vitest";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdfimagesCommand } from "./index.js";

for (const entry of [
  { title: "only budgets source bytes: Pdfimages in.pdf out", args: ["in.pdf", "out"], create: createPdfimagesCommand, stdin: false },
  { title: "only budgets source bytes: Pdfimages - out", args: ["-", "out"], create: createPdfimagesCommand, stdin: true }
]) {
  test(entry.title, async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([8, 8]);
    page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 8, height: 8 });
    const input = doc.save();
    const fs = createMemoryFileSystem(); await fs.mkdir("/tmp");
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
    expect(result.exitCode).toBe(0);
  });
}
