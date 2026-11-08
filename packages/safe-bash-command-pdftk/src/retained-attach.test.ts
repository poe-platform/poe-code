import { expect, it } from "vitest";
import { PdfDocument, cosArray, cosDict, cosString, dictGet, dictSet, serializeCosDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftkCommand, runPdftkCli } from "./index.js";

it.each(["plain", "page", "end", "duplicates", "missing", "stdin", "empty", "compress", "direct", "indirect", "odd", "existing-annots", "inline-page"])("embeds %s attachments without whole-file I/O", async mode => {
  const doc = PdfDocument.create(); doc.addPage(); doc.addPage();
  if (["direct", "indirect", "odd"].includes(mode)) {
    const names = cosArray(mode === "odd" ? [cosString("orphan")] : [cosString("existing"), cosDict({})]);
    const tree = cosDict({ Names: mode === "indirect" ? doc.cos.allocateObject(names) : names });
    const dictionary = cosDict({ EmbeddedFiles: mode === "indirect" ? doc.cos.allocateObject(tree) : tree });
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Names", mode === "indirect" ? doc.cos.allocateObject(dictionary) : dictionary);
  }
  if (mode === "existing-annots") dictSet(doc.getPage(0).pageDict, "Annots", doc.cos.allocateObject(cosArray([cosDict({ Contents: cosString("existing") })])));
  if (mode === "inline-page") {
    const pages = doc.cos.resolveDict(dictGet(doc.cos.resolveDict(doc.cos.rootRef)!, "Pages"))!;
    dictSet(pages, "Kids", cosArray([doc.getPage(0).pageDict]));
  }
  const input = mode === "inline-page" ? serializeCosDocument({ objects: [...doc.cos.objects.values()], rootRef: doc.cos.rootRef, infoRef: doc.cos.infoRef }) : doc.save(), payload = new TextEncoder().encode("payload".repeat(10000));
  const operands = mode === "empty" ? [] : mode === "stdin" ? ["-"] : mode === "missing" ? ["missing", "data.bin"] : mode === "duplicates" ? ["data.bin", "data.bin"] : ["data.bin"];
  const args = ["in.pdf", "attach_files", ...operands, ...(mode === "page" || mode === "end" || mode === "existing-annots" || mode === "inline-page" ? ["to_page", mode === "end" ? "end" : "1"] : []), "output", "out.pdf", ...(mode === "compress" ? ["compress"] : [])];
  const files = new Map([["in.pdf", input], ["data.bin", payload], ["-", payload]]), expected = await runPdftkCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/data.bin", payload);
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args); let stderr = "";
  const result = await createPdftkCommand({ limits: { maxInputBytes: input.length + payload.length } }).execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal, stdin: (async function* () { yield payload; })(), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode).toBe(expected.exitCode); expect(stderr).toBe(expected.stderr); expect(await fs.readFile("/out.pdf")).toEqual(files.get("out.pdf")); expect(await fs.readdir("/scratch")).toEqual([]);
});
