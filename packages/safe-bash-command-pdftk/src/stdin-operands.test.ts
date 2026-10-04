import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { expect, it } from "vitest";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createPdftkCommand } from "./index.js";

const cases: [string[], number][] = [[["in.pdf", "cat", "1", "output", "-"], 0], [["in.pdf", "output", "-"], 0], [["A=-", "cat", "1", "output", "out.pdf"], 1]];
for (const op of ["update_info", "update_info_utf8", "fill_form", "background", "multibackground", "stamp", "multistamp"]) {
  cases.push([["in.pdf", op, "output", "out.pdf"], 1]);
}
for (const [args, expectedReads] of cases) {
  it(JSON.stringify(args), async () => {
    const doc = PdfDocument.create(); doc.addPage().drawText("Fixture", { x: 20, y: 20, size: 12 });
    const pdf = doc.save();
    const stdin = args[1]?.startsWith("update_info")
      ? new TextEncoder().encode("InfoBegin\nInfoKey: Title\nInfoValue: From stdin\n")
      : args[1] === "fill_form" ? new TextEncoder().encode('<?xml version="1.0"?><xfdf xmlns="http://ns.adobe.com/xfdf/"><fields/></xfdf>') : pdf;
    const files = new Map<string, Uint8Array>([["/work/in.pdf", pdf], ["/work/args.txt", new TextEncoder().encode("in.pdf\r\n--npages\r\n")], ["/work/transform.txt", new TextEncoder().encode("in.pdf\nout.pdf\n")], ["/work/stdin.txt", new TextEncoder().encode("-\n--npages\n")]]);
    const fs = createMemoryFileSystem(); await fs.mkdir("/work");
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    let reads = 0;
    const output: Uint8Array[] = [], errors: Uint8Array[] = [];
    const carrier = createCommandArguments(args);
    const context = {
      command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/work", env: {},
      signal: new AbortController().signal, registerCleanup() {},
      stdin: { async *[Symbol.asyncIterator]() { reads++; yield stdin.slice(0, 30); yield stdin.slice(30); } },
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } },
      fs
    } as unknown as CommandContext;
    const result = await createPdftkCommand().execute(context);
    expect(result.exitCode, errors.map(bytes => new TextDecoder().decode(bytes)).join("" )).toBe(0);
    expect(reads).toBe(expectedReads);
    expect(output.length || await fs.stat("/work/out.pdf").then(() => true, () => false)).toBeTruthy();
    if (await fs.stat("/work/out.pdf").then(() => true, () => false)) expect(PdfDocument.load(await fs.readFile("/work/out.pdf")).getPageCount()).toBe(1);
  });
}
