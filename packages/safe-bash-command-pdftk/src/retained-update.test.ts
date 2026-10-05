import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosHexString, cosNumber, dictGet, dictSet, serializeCosDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftkCommand, runPdftkCli } from "./index.js";

const info = `InfoBegin
InfoKey: Title
InfoValue: Updated &#321;&#243;d&#378;
InfoBegin
InfoKey: Custom
InfoValue: custom
PageMediaBegin
PageMediaNumber: 2
PageMediaRotation: -90
PageMediaDimensions: 500 600
PageMediaRect: 10 20 300 400
PageMediaCropBox: 20 30 200 300
PageMediaBegin
PageMediaNumber: 2
PageMediaDimensions: 111 222
PageLabelBegin
PageLabelNewIndex: 1
PageLabelStart: 1
PageLabelPrefix: Pre
PageLabelNumStyle: UppercaseRomanNumerals
BookmarkBegin
BookmarkTitle: Root
BookmarkLevel: 1
BookmarkPageNumber: 1
BookmarkBegin
BookmarkTitle: Child
BookmarkLevel: 3
BookmarkPageNumber: 2
PdfID0: 00112233
PdfID1: aabbccdd
`;
it.each(["plain", "utf8", "stdin", "compress", "uncompress", "empty", "no-info", "invalid-info", "indirect-info", "alias", "first-id", "partial-id", "unknown-style", "crlf", "encrypted", "large-numbers"])("updates %s info without whole-file I/O", async mode => {
  const doc = PdfDocument.create(); doc.addPage(); doc.addPage();
  doc.cos.idArray = cosArray([cosHexString(Uint8Array.of(1, 2)), cosHexString(Uint8Array.of(3, 4))]);
  if (mode === "no-info") doc.cos.infoRef = undefined;
  if (mode === "invalid-info") doc.cos.infoRef = doc.cos.allocateObject(cosNumber(42));
  if (mode === "indirect-info") doc.cos.infoRef = doc.cos.allocateObject(doc.cos.infoRef!);
  if (mode === "alias") dictSet(doc.cos.resolveDict(dictGet(doc.cos.resolveDict(doc.cos.rootRef)!, "Pages"))!, "Kids", cosArray([doc.getPage(0).ref, doc.getPage(0).ref]));
  const input = mode === "encrypted" ? doc.save({ encrypt: { userPassword: "secret", ownerPassword: "owner" } }) : serializeCosDocument({ objects: [...doc.cos.objects.values()], rootRef: doc.cos.rootRef, infoRef: doc.cos.infoRef, idArray: doc.cos.idArray });
  let text = mode === "empty" ? "" : info;
  if (mode === "no-info" || mode === "invalid-info") text = "InfoBegin\nInfoKey: Custom\nInfoValue: First\n" + text;
  if (mode === "alias") text += "PageMediaBegin\nPageMediaNumber: 1\nPageMediaDimensions: 101 102\nPageMediaBegin\nPageMediaNumber: 2\nPageMediaDimensions: 201 202\nPageMediaBegin\nPageMediaNumber: 1\nPageMediaDimensions: 301 302\n";
  if (mode === "partial-id") text = "PdfID0: abcd\nPdfID0: 9999";
  if (mode === "unknown-style") text += "PageLabelBegin\nPageLabelNumStyle: Unknown";
  if (mode === "crlf") text = text.replaceAll("\n", "\r\n");
  if (mode === "large-numbers") text = `BookmarkBegin\nBookmarkTitle: Large\nBookmarkLevel: ${"9".repeat(400)}\nBookmarkPageNumber: ${"9".repeat(400)}\nPageMediaBegin\nPageMediaNumber: 1\nPageMediaRotation: ${"9".repeat(400)}`;
  const data = new TextEncoder().encode(text);
  const args = ["in.pdf", ...(mode === "encrypted" ? ["input_pw", "secret"] : []), mode === "utf8" ? "update_info_utf8" : "update_info", mode === "stdin" ? "-" : "info", "output", "out.pdf", ...(mode === "first-id" ? ["keep_first_id"] : []), ...(mode === "compress" || mode === "uncompress" ? [mode] : [])];
  const files = new Map([["in.pdf", input], ["info", data], ["-", data]]), expected = await runPdftkCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/info", data);
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args); let stderr = "";
  const result = await createPdftkCommand({ limits: { maxInputBytes: input.length + data.length } }).execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* () { const buffer = new Uint8Array(17); for (let i = 0; i < data.length; i += buffer.length) { const length = Math.min(buffer.length, data.length - i); buffer.set(data.subarray(i, i + length)); yield buffer.subarray(0, length); } })(),
    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode, stderr).toBe(expected.exitCode); expect(stderr).toBe(expected.stderr);
  expect(await fs.readFile("/out.pdf")).toEqual(files.get("out.pdf")); expect(await fs.readdir("/scratch")).toEqual([]);
});


it.each(["write", "cancel"])("cleans metadata updates and preserves destination after %s failure", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const doc = PdfDocument.create(); doc.addPage();
  await fs.writeFile("/in.pdf", doc.save()); await fs.writeFile("/info", new TextEncoder().encode(info)); await fs.writeFile("/out.pdf", Uint8Array.of(7));
  const reason = new Error("metadata publication failed"), controller = new AbortController();
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const file = await fs.createStagedFile!(...args); return { ...file, writer: { ...file.writer!, write: async () => { if (mode === "cancel") controller.abort(reason); throw reason; } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const args = createCommandArguments(["in.pdf", "update_info", "info", "output", "out.pdf"]);
  await expect(createPdftkCommand().execute({ command: "pdftk", args: args.args, argumentValues: args, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })).rejects.toBe(reason);
  expect(await fs.readFile("/out.pdf")).toEqual(Uint8Array.of(7)); expect(await fs.readdir("/scratch")).toEqual([]);
});
