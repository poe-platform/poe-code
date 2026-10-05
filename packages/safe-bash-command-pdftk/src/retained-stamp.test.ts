import { expect, it } from "vitest";
import { PdfDocument, cosArray, cosDict, cosName, cosStream, dictDelete, dictGet, dictSet } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftkCommand, runPdftkCli } from "./index.js";

it.each(["stamp", "multistamp", "background", "multibackground"].flatMap(operation => ["plain", "rotation", "stdin", "empty", "streams", "absent", "collisions", "unicode"].map(mode => ({ operation, mode }))))("streams $operation with $mode source", async ({ operation, mode }) => {
  const target = PdfDocument.create(), source = PdfDocument.create();
  for (let i = 0; i < 3; i++) { const page = target.addPage([200, 300]); page.drawText(`Target ${i}`, { x: 10, y: 20 }); if (mode === "rotation") page.setRotation(90); }
  if (mode !== "empty") for (let i = 0; i < 2; i++) source.addPage([100, 100]).drawText(`Stamp ${i}`, { x: 10, y: 20 });
  if (mode === "absent") for (const page of source.getPages()) dictDelete(page.pageDict, "Contents");
  if (mode === "streams") for (const page of source.getPages()) {
    const existing = dictGet(page.pageDict, "Contents")!;
    const extra = source.cos.allocateObject(cosStream(new TextEncoder().encode("/F1 /F1suffix /F1! (%/F1)"), { compress: true }));
    dictSet(page.pageDict, "Contents", cosArray([existing, extra, existing]));
  }
  if (mode === "collisions") {
    for (const page of target.getPages()) { const fonts = target.cos.resolveDict(dictGet(page.getResourcesDict(), "Font"))!; dictSet(fonts, `Ov_${page.ref.objectNumber}_F1`, cosDict({})); dictSet(fonts, "Ov_0_F1", cosDict({})); }
    for (const page of source.getPages()) dictSet(page.getResourcesDict(), "ExtGState", cosDict({ F1: cosDict({ Type: cosName("ExtGState") }) }));
  }
  if (mode === "unicode") for (const page of source.getPages()) page.drawText("Łódź", { x: 10, y: 40 });
  const input = target.save(), stamp = source.save(), args = ["in.pdf", operation, mode === "stdin" ? "-" : "stamp.pdf", "output", "out.pdf"];
  const files = new Map([["in.pdf", input], ["stamp.pdf", stamp], ["-", stamp]]), expected = await runPdftkCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/stamp.pdf", stamp);
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args); let stderr = "";
  const result = await createPdftkCommand({ limits: { maxInputBytes: input.length + stamp.length } }).execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal, stdin: (async function* () { yield stamp; })(), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode).toBe(expected.exitCode); expect(stderr).toBe(expected.stderr); expect(await fs.readFile("/out.pdf")).toEqual(files.get("out.pdf")); expect(await fs.readdir("/scratch")).toEqual([]);
});


it.each(["write", "cancel"])("cleans stamp backing and preserves output after %s failure", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const doc = PdfDocument.create(); doc.addPage().drawText("stamp", { x: 10, y: 20 });
  await fs.writeFile("/in.pdf", doc.save()); await fs.writeFile("/stamp.pdf", doc.save()); await fs.writeFile("/out.pdf", Uint8Array.of(7));
  const reason = new Error("stamp failed"), controller = new AbortController();
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const file = await fs.createStagedFile!(...args); return { ...file, writer: { ...file.writer!, write: async () => { if (mode === "cancel") controller.abort(reason); throw reason; } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const args = createCommandArguments(["in.pdf", "stamp", "stamp.pdf", "output", "out.pdf"]);
  await expect(createPdftkCommand().execute({ command: "pdftk", args: args.args, argumentValues: args, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })).rejects.toBe(reason);
  expect(await fs.readFile("/out.pdf")).toEqual(Uint8Array.of(7)); expect(await fs.readdir("/scratch")).toEqual([]);
});
