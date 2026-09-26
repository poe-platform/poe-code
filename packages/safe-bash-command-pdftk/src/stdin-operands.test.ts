import { expect, it } from "vitest";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createPdftkCommand } from "./index.js";

const cases: [string[], number][] = [[["in.pdf", "cat", "1", "output", "-"], 0], [["in.pdf", "output", "-"], 0], [["A=-", "cat", "1", "output", "out.pdf"], 1]];
for (const [args, expectedReads] of cases) {
  it(JSON.stringify(args), async () => {
    const doc = PdfDocument.create(); doc.addPage().drawText("Fixture", { x: 20, y: 20, size: 12 });
    const pdf = doc.save();
    const files = new Map<string, Uint8Array>([["/work/in.pdf", pdf], ["/work/args.txt", new TextEncoder().encode("in.pdf\r\n--npages\r\n")], ["/work/transform.txt", new TextEncoder().encode("in.pdf\nout.pdf\n")], ["/work/stdin.txt", new TextEncoder().encode("-\n--npages\n")]]);
    let reads = 0;
    const output: Uint8Array[] = [], errors: Uint8Array[] = [];
    const carrier = createCommandArguments(args);
    const context = {
      command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/work", env: {},
      signal: new AbortController().signal, registerCleanup() {},
      stdin: { async *[Symbol.asyncIterator]() { reads++; yield pdf.slice(0, 30); yield pdf.slice(30); } },
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } },
      fs: { async readFile(path: string) { const bytes = files.get(path); if (!bytes) throw new Error("missing"); return bytes; },
        async writeFile(path: string, bytes: Uint8Array) { files.set(path, bytes); } }
    } as unknown as CommandContext;
    const result = await createPdftkCommand().execute(context);
    expect(result.exitCode, errors.map(bytes => new TextDecoder().decode(bytes)).join("" )).toBe(0);
    expect(reads).toBe(expectedReads);
    expect(output.length || files.has("/work/out.pdf")).toBeTruthy();
    if (files.has("/work/out.pdf")) expect(PdfDocument.load(files.get("/work/out.pdf")!).getPageCount()).toBe(1);
  });
}
