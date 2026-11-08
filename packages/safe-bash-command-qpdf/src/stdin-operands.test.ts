import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { qpdf } from "./index.js";

const cases: [string[], number][] = [[["-", "--npages"], 1], [["-", "--show-npages"], 1], [["-", "--check"], 1], [["-", "out.pdf"], 1], [["-", "-"], 1], [["in.pdf", "-"], 0], [["@args.txt"], 0], [["@transform.txt"], 0], [["@stdin.txt"], 1]];
for (const [args, expectedReads] of cases) {
  it(JSON.stringify(args), async () => {
    const doc = PdfDocument.create(); doc.addPage().drawText("Fixture", { x: 20, y: 20, size: 12 });
    const pdf = doc.save();
    const files = new Map<string, Uint8Array>([["/work/in.pdf", pdf], ["/work/args.txt", new TextEncoder().encode("in.pdf\r\n--npages\r\n")], ["/work/transform.txt", new TextEncoder().encode("in.pdf\nout.pdf\n")], ["/work/stdin.txt", new TextEncoder().encode("-\n--npages\n")]]);
    const fs = createMemoryFileSystem(); await fs.mkdir("/work"); for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    let reads = 0;
    const output: Uint8Array[] = [], errors: Uint8Array[] = [];
    const carrier = createCommandArguments(args);
    const context = {
      command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/work", env: {},
      signal: new AbortController().signal, registerCleanup() {},
      stdin: { async *[Symbol.asyncIterator]() { reads++; yield pdf.slice(0, 30); yield pdf.slice(30); } },
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } },
      fs
    } as unknown as CommandContext;
    const result = await qpdf(context);
    assert.equal(result.exitCode, 0, new TextDecoder().decode(Buffer.concat(errors)));
    assert.equal(reads, expectedReads);
    const saved = await fs.readFile("/work/out.pdf").catch(() => undefined);
    assert.ok(output.length || saved);
    if (saved) assert.equal(PdfDocument.load(saved).getPageCount(), 1);
    if (args.includes("--npages") || args[0] === "@args.txt" || args[0] === "@stdin.txt") assert.equal(new TextDecoder().decode(Buffer.concat(output)), "1\n");
  });
}
