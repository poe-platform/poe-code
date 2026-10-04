import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosBool, cosDict, cosName, cosNumber, cosStream, cosString, dictSet, serializeCosDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

const allFlags = ["--remove-info", "--remove-metadata", "--remove-structure", "--remove-acroform", "--remove-page-labels"];
for (const mode of ["plain", "encrypted", "encrypted-decrypt", "compressed", "moddate", "info-alias", "info-catalog", "info-page", "info-stream", "catalog-stream"]) for (const flags of [...allFlags.map(flag => [flag]), allFlags]) {
  it(`removes retained ${mode} document entries with exact bytes: ${flags.join(" ")}`, async () => {
    const doc = PdfDocument.create(); doc.addPage().drawText("Retained removal", { x: 10, y: 20 });
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!, info = doc.cos.resolveDict(doc.cos.infoRef)!;
    dictSet(info, "Title", cosString("Private title"));
    if (mode === "moddate") dictSet(info, "ModDate", cosString("D:20260101000000Z"));
    const metadata = doc.cos.allocateObject(cosStream(new Uint8Array(131072).fill(65), { dict: cosDict({ Type: cosName("Metadata"), Subtype: cosName("XML") }), compress: true }));
    dictSet(catalog, "Metadata", metadata); dictSet(catalog, "StructTreeRoot", cosDict({ Type: cosName("StructTreeRoot") }));
    dictSet(catalog, "MarkInfo", cosDict({ Marked: cosBool(true) })); dictSet(catalog, "AcroForm", cosDict({ Fields: cosArray([]) }));
    dictSet(catalog, "PageLabels", cosDict({ Nums: cosArray([cosNumber(0), cosDict({ S: cosName("D") })]) }));
    if (mode === "info-catalog") doc.cos.infoRef = doc.cos.rootRef;
    if (mode === "info-page") doc.cos.infoRef = doc.getPage(0).ref;
    if (mode === "info-alias") doc.cos.infoRef = doc.cos.allocateObject(doc.cos.infoRef!);
    if (mode === "info-stream" || mode === "catalog-stream") {
      const ref = mode === "info-stream" ? doc.cos.infoRef! : doc.cos.rootRef, original = doc.cos.objects.get(ref.objectNumber)!;
      doc.cos.objects.set(ref.objectNumber, { ...original, value: cosStream(new Uint8Array([65]), { dict: original.value as ReturnType<typeof cosDict>, compress: false }) });
    }
    const input = mode.endsWith("stream") ? serializeCosDocument({ objects: [...doc.cos.objects.values()], rootRef: doc.cos.rootRef, infoRef: doc.cos.infoRef }) : doc.save(mode.startsWith("encrypted") ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : mode === "compressed" ? { objectStreams: "generate" } : {});
    const args = [...flags, ...(mode === "encrypted-decrypt" ? ["--decrypt"] : []), ...(mode.startsWith("encrypted") ? ["--password=reader"] : []), "in.pdf", "out.pdf"], files = new Map([["in.pdf", input]]), expected = await runQpdfCli(args, files);
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
    const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
      if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
      const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
    } });
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
    const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
      stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } } });
    assert.equal(result.exitCode, expected.exitCode); assert.equal(Buffer.concat(stdout).toString(), expected.stdout); assert.equal(Buffer.concat(stderr).toString(), expected.stderr);
    assert.deepEqual(await fs.readFile("/out.pdf"), files.get("out.pdf")); assert.deepEqual(await fs.readFile("/in.pdf"), input); assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}
