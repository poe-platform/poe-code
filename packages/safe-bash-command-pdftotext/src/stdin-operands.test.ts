import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { pdftohtml } from "./index.js";

const cases: [string[], number][] = [[["in.pdf", "-"], 0], [["-f", "1", "in.pdf", "-"], 0], [["-upw", "-", "in.pdf", "-"], 0], [["-", "-"], 1]];
for (const [args, expectedReads] of cases) {
  it(JSON.stringify(args), async () => {
    const doc = PdfDocument.create(); doc.addPage().drawText("Fixture", { x: 20, y: 20, size: 12 });
    const pdf = doc.save();
    const files = new Map<string, Uint8Array>([["/work/in.pdf", pdf], ["/work/args.txt", new TextEncoder().encode("in.pdf\r\n--npages\r\n")], ["/work/transform.txt", new TextEncoder().encode("in.pdf\nout.pdf\n")], ["/work/stdin.txt", new TextEncoder().encode("-\n--npages\n")]]);
    let reads = 0;
    const output: Uint8Array[] = [], errors: Uint8Array[] = [];
    const carrier = createCommandArguments(args);
    const context = {
      command: "pdftotext", args: carrier.args, argumentValues: carrier, cwd: "/work", env: {},
      signal: new AbortController().signal, registerCleanup() {},
      stdin: { async *[Symbol.asyncIterator]() { reads++; yield pdf.slice(0, 30); yield pdf.slice(30); } },
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } },
      fs: { async readFile(path: string) { const bytes = files.get(path); if (!bytes) throw new Error("missing"); return bytes; },
        async writeFile(path: string, bytes: Uint8Array) { files.set(path, bytes); } }
    } as unknown as CommandContext;
    const result = await pdftohtml(context);
    assert.equal(result.exitCode, 0, new TextDecoder().decode(Buffer.concat(errors)));
    assert.equal(reads, expectedReads);
    assert.ok(output.length || files.has("/work/out.pdf"));
    if (files.has("/work/out.pdf")) assert.equal(PdfDocument.load(files.get("/work/out.pdf")!).getPageCount(), 1);
    if (args.includes("--npages") || args[0] === "@args.txt" || args[0] === "@stdin.txt") assert.equal(new TextDecoder().decode(Buffer.concat(output)), "1\n");
  });
}
