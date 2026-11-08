import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

function orderedPdf(mode: string): Uint8Array {
  const objects: [number, string][] = [[1, "<< /Type /Catalog /Pages 2 0 R >>"], [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"], [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 200] >>"],
    [5, "<< /Linearized 1 /L 555 /H [7 0 R 8 0 R] >>"], [4, "<< /Linearized 1 /L 444 /H [8 0 R 7 0 R] /N 12 /O 9 >>"], [7, "true"], [8, "20"]];
  if (mode === "inline") objects[1] = [2, "<< /Type /Pages /Kids [<< /Type /Page /MediaBox [0 0 100 200] /Linearized 1 /L 777 >>] /Count 1 >>"];
  if (mode === "inline") { objects.splice(3, 2); }
  if (mode === "repaired-broken-stream") { objects.splice(3, 2); objects.push([9, "<< /Type /ObjStm /N 2 /First 0 /Length 4 >>\nstream\njunk\nendstream"]); }
  let text = "%PDF-1.7\n"; const offsets = new Map<number, number>();
  for (const [number, body] of objects) { offsets.set(number, text.length); text += `${number} 0 obj\n${body}\nendobj\n`; }
  if (mode === "repaired" || mode === "repaired-broken-stream") return new TextEncoder().encode(text + "trailer << /Root 1 0 R /Size 9 >>\n%%EOF\n");
  const start = text.length; text += "xref\n0 1\n0000000000 65535 f \n";
  for (const number of mode === "inline" ? [1, 2, 3, 7, 8] : mode === "reverse" ? [5, 4, 1, 2, 3, 7, 8] : [1, 2, 3, 4, 5, 7, 8]) text += `${number} 1\n${String(offsets.get(number)).padStart(10, "0")} 00000 n \n`;
  text += `trailer << /Root 1 0 R /Size 9 >>\nstartxref\n${start}\n%%EOF\n`;
  if (mode === "incremental") {
    const offset = text.length; text += "5 0 obj\n<< /Linearized 1 /L 999 >>\nendobj\n";
    const xref = text.length; text += `xref\n5 1\n${String(offset).padStart(10, "0")} 00000 n \ntrailer << /Root 1 0 R /Size 9 /Prev ${start} >>\nstartxref\n${xref}\n%%EOF\n`;
  }
  return new TextEncoder().encode(text);
}
for (const mode of ["plain", "linearized", "reverse", "repaired", "incremental", "encrypted", "alias", "precedence", "empty", "inline", "compressed", "repaired-compressed", "repaired-broken-stream"]) it(`inspects ${mode} linearization using retained input with exact diagnostics`, async () => {
  const doc = PdfDocument.create(); doc.addPage([100, 200]);
  let input = mode === "plain" || mode === "encrypted" ? doc.save(mode === "encrypted" ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : {}) : orderedPdf(mode);
  if (mode.endsWith("compressed")) {
    const files = new Map([["in.pdf", input]]); await runQpdfCli(["in.pdf", "--object-streams=generate", "out.pdf"], files); input = files.get("out.pdf")!;
    if (mode === "repaired-compressed") input = input.subarray(0, Buffer.from(input).lastIndexOf("startxref"));
  }
  const args = [...(mode === "encrypted" ? ["--password=reader"] : []), ...(mode === "empty" ? ["--empty"] : ["in.pdf"]), mode === "alias" ? "--check-linearization" : "--show-linearization", ...(mode === "precedence" ? ["--check", "--show-npages", "--list-attachments"] : [])];
  const expected = await runQpdfCli(args, new Map([["in.pdf", input]]));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  const guarded = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file linearization I/O forbidden"); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
  const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } } });
  assert.equal(result.exitCode, expected.exitCode); assert.equal(Buffer.concat(stdout).toString(), expected.stdout); assert.equal(Buffer.concat(stderr).toString(), expected.stderr);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
