import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfRetainedDocument, PdfDocument, cosArray, cosDict, cosName, cosNumber, cosString, cosStream, dictSet } from "@poe-code/pdf-ast";
import { createPdfinfoCommand, inspectPdfBytes } from "./index.js";

for (const flags of [[], ["-box"], ["-custom"], ["-meta"], ["-js"], ["-struct-text"], ["-dests"], ["-url"], ["-f", "2", "-l", "2"], ["-f", "3"], ["-enc", "ASCII7"]]) {
  it(`retains pdfinfo input with buffered parity: ${flags.join(" ")}`, async () => {
    const doc = PdfDocument.create(); doc.addPage().drawText("first", { x: 0, y: 0 }); doc.addPage(); doc.setMetadata({ title: "Résumé" });
    const root = doc.cos.resolveDict(doc.cos.rootRef)!;
    const page = doc.getPage(0);
    page.setRawContentStream("/P << /MCID 0 >> BDC BT (Tagged text) Tj ET EMC");
    page.addLinkAnnotation({ rect: [0, 0, 10, 10], uri: "https://example.com/é" });
    dictSet(root, "Metadata", doc.cos.allocateObject(cosStream(new TextEncoder().encode("<xml>é\r\n</xml>\0ignored"))));
    dictSet(root, "OpenAction", cosDict({ S: cosName("JavaScript"), JS: doc.cos.allocateObject(cosStream(new TextEncoder().encode("console.log('é');"))) }));
    dictSet(root, "StructTreeRoot", cosDict({ K: cosDict({ S: cosName("P"), Pg: page.ref, K: cosNumber(0) }) }));
    dictSet(root, "Dests", cosDict({ section: cosArray([page.ref, cosName("Fit")]) }));
    const info = doc.cos.resolveDict(doc.cos.infoRef!)!;
    dictSet(info, "Zed", cosString("last")); dictSet(info, "Alpha", cosString("first"));
    const bytes = doc.save(); const args = [...flags, "in.pdf"]; const expected = inspectPdfBytes(bytes, args);
    const fs = createMemoryFileSystem(); await fs.mkdir("/tmp"); await fs.writeFile("/in.pdf", bytes);
    const injected = new Proxy(fs, { get(target, key) {
      if (key === "readFile") return async () => { throw new Error("whole input read forbidden"); };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    let stdout = "", stderr = "";
    const result = await createPdfinfoCommand({ limits: { maxInputBytes: bytes.length } }).execute({
      command: "pdfinfo", args, cwd: "/", env: {}, fs: injected, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    });
    assert.deepEqual({ exitCode: result.exitCode, stdout, stderr }, expected);
    assert.deepEqual(await fs.readdir("/tmp"), []);
  });
}

it("awaits a slow info sink and preserves cancellation while cleaning storage", async () => {
  const doc = PdfDocument.create(); doc.addPage(); doc.setTitle("x".repeat(200000));
  const fs = createMemoryFileSystem(); await fs.writeFile("/in.pdf", doc.save());
  const controller = new AbortController(); const failure = new Error("stop info sink"); let pending = 0, writes = 0;
  await assert.rejects(async () => createPdfinfoCommand().execute({
    command: "pdfinfo", args: ["in.pdf"], cwd: "/", env: {}, fs, signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stderr: { async write() {} },
    stdout: { async write(bytes) {
      assert.equal(pending, 0); pending += bytes.length; writes++;
      await new Promise<void>(resolve => setTimeout(resolve, 0)); pending -= bytes.length;
      if (writes === 2) controller.abort(failure);
    } },
  }), error => error === failure);
  assert.equal(writes, 2); assert.equal(pending, 0); assert.deepEqual(await fs.readdir("/tmp"), []);
});

for (const kind of ["missing", "empty", "password"] as const) {
  it(`preserves info ${kind} error output and cleans retained state`, async () => {
    const fs = createMemoryFileSystem(); const doc = PdfDocument.create(); doc.addPage();
    const bytes = kind === "empty" ? new Uint8Array() : doc.save({ encrypt: { revision: 3, userPassword: "secret", ownerPassword: "owner" } });
    if (kind !== "missing") await fs.writeFile("/in.pdf", bytes);
    let stdout = "", stderr = "";
    const result = await createPdfinfoCommand().execute({
      command: "pdfinfo", args: ["in.pdf"], cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    const expected = kind === "missing" ? { exitCode: 1, stdout: "", stderr: "I/O Error: Couldn't open file 'in.pdf': No such file or directory.\n" } : inspectPdfBytes(bytes, ["in.pdf"]);
    assert.deepEqual({ exitCode: result.exitCode, stdout, stderr }, expected);
    assert.deepEqual(await fs.readdir("/tmp"), []);
  });
}

for (const flags of [[], ["-js"]]) {
  it(`validates lazy JavaScript payloads before publishing info: ${flags.join(" ")}`, async () => {
    const doc = PdfDocument.create(); doc.addPage(); doc.setTitle("Must not publish");
    const root = doc.cos.resolveDict(doc.cos.rootRef)!;
    const invalid = doc.cos.allocateObject(cosStream(cosDict({ Filter: cosName("UnsupportedFilter") }), new Uint8Array([1, 2, 3])));
    dictSet(root, "OpenAction", cosDict({ S: cosName("JavaScript"), JS: cosString("valid first script"), Next: cosDict({ S: cosName("JavaScript"), JS: invalid }) }));
    const bytes = doc.save();
    assert.throws(() => inspectPdfBytes(bytes, [...flags, "in.pdf"]));
    const fs = createMemoryFileSystem(); await fs.writeFile("/in.pdf", bytes); let stdout = "";
    await assert.rejects(async () => createPdfinfoCommand().execute({
      command: "pdfinfo", args: [...flags, "in.pdf"], cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} }, stderr: { async write() {} },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    }));
    assert.equal(stdout, ""); assert.deepEqual(await fs.readdir("/tmp"), []);
  });
}

it("preserves an output staging failure without publishing or leaking input state", async t => {
  const fs = createMemoryFileSystem(); const doc = PdfDocument.create(); doc.addPage(); await fs.writeFile("/in.pdf", doc.save());
  const failure = new Error("injected inspection staging failure"); let inputOpened = false, injected = false, published = false;
  const open = PdfRetainedDocument.open;
  t.mock.method(PdfRetainedDocument, "open", async (...args: Parameters<typeof open>) => {
    const document = await open(...args); inputOpened = true; return document;
  });
  const backed = new Proxy(fs, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<typeof fs.createStagedFile>) => {
      const stage = await target.createStagedFile(...args);
      if (!inputOpened) return stage;
      return { ...stage, writer: { ...stage.writer!, async write() { injected = true; throw failure; } } };
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  await assert.rejects(async () => createPdfinfoCommand().execute({
    command: "pdfinfo", args: ["in.pdf"], cwd: "/", env: {}, fs: backed, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stderr: { async write() {} }, stdout: { async write() { published = true; } },
  }), error => error === failure);
  assert.equal(injected, true); assert.equal(published, false); assert.deepEqual(await fs.readdir("/tmp"), []);
});
