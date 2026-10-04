import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosBool, cosDict, cosName, cosNumber, cosStream, cosString, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["plain", "encrypted", "packed", "repaired", "empty", "stdin", "labels", "fields", "outlines", "attachments", "selectors", "pages", "inline", "file", "destination", "keys1", "keys2"]) for (const version of [1, 2]) it(`streams JSON ${version} ${mode} with exact bytes`, async () => {
  const doc = PdfDocument.create(), page = doc.addPage([100, 200]); page.drawText("JSON", { x: 10, y: 20 }); doc.addPage([200, 100]);
  const root = doc.cos.resolveDict(doc.cos.rootRef)!;
  if (mode === "labels") dictSet(root, "PageLabels", cosDict({ Nums: cosArray([cosNumber(0), cosDict({ S: cosName("r"), P: cosString("π"), St: cosNumber(4) })]) }));
  if (mode === "fields") dictSet(root, "AcroForm", cosDict({ NeedAppearances: cosBool(true), Fields: cosArray([cosDict({ T: cosString("field"), FT: cosName("Tx"), V: cosString("value") })]) }));
  if (mode === "outlines") {
    dictSet(root, "Dests", cosDict({ second: cosArray([doc.getPage(1).ref, cosName("Fit")]) }));
    const child = doc.cos.allocateObject(cosDict({ Title: cosString("nested"), A: cosDict({ D: cosString("second") }) }));
    const first = doc.cos.allocateObject(cosDict({ Title: cosString("first"), Dest: cosArray([page.ref, cosName("Fit")]), First: child }));
    dictSet(doc.cos.resolveDict(child)!, "Next", first); dictSet(root, "Outlines", cosDict({ First: first }));
  }
  if (mode === "attachments") {
    const stream = doc.cos.allocateObject(cosStream(new Uint8Array(8193).fill(241), { compress: false }));
    const spec = cosDict({ F: cosString("file.bin"), EF: cosDict({ F: stream }) });
    dictSet(root, "Names", cosDict({ EmbeddedFiles: cosDict({ Names: cosArray([cosString("9"), spec, cosString("2"), spec, cosString("__proto__"), spec, cosString("a"), spec]) }) }));
  }
  let input = doc.save(mode === "encrypted" ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : mode === "packed" ? { objectStreams: "generate" } : {});
  if (mode === "repaired") input = input.subarray(0, Buffer.from(input).lastIndexOf("startxref"));
  const name = mode === "stdin" ? "-" : "in.pdf";
  const args = [...(mode === "empty" ? ["--empty"] : [name]), `--json=${version}`, ...(mode === "encrypted" ? ["--password=reader"] : []),
    ...(mode === "selectors" ? ["--json-object=trailer", "--json-object=1"] : []), ...(mode === "pages" ? ["--json-key=pages"] : []),
    ...(mode === "inline" ? ["--json-stream-data=inline"] : []), ...(mode === "file" ? ["--json-stream-data=file", "--json-stream-prefix=streams-"] : []),
    ...(mode === "destination" ? ["out.json"] : []), ...(mode === "keys1" ? ["--json-key=qpdf"] : []), ...(mode === "keys2" ? ["--json-key=objects"] : [])];
  const files = new Map([[name, input]]), expected = await runQpdfCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  const guarded = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file JSON I/O forbidden"); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
  const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* () { for (let at = 0; at < input.length; at += 4096) yield input.subarray(at, at + 4096); })(),
    stdout: { async write(bytes: Uint8Array) { assert.ok(bytes.buffer.byteLength <= 65536); stdout.push(bytes.slice()); await Promise.resolve(); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } } });
  assert.equal(result.exitCode, expected.exitCode); assert.equal(Buffer.concat(stderr).toString(), expected.stderr); assert.equal(Buffer.concat(stdout).toString(), expected.stdout);
  for (const [name, bytes] of files) if (bytes !== input) assert.deepEqual(await fs.readFile(`/${name}`), bytes);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const mode of ["reverse", "incremental", "repaired-order", "inline-page", "duplicates", "zero-stream", "default-prefix", "replace-input", "missing-prefix", "empty-prefix"]) it(`preserves JSON ${mode} behavior`, async () => {
  const bodies: [number, string][] = [[1, "<< /Type /Catalog /Pages 2 0 R >>"], [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"], [3, "<< /Type /Page /MediaBox [0 0 100 200] >>"], [5, "<< /X 1 /X 2 /A (text) /X 3 >>"], [4, "<< /Length 0 >>\nstream\n\nendstream"]];
  if (mode === "inline-page") bodies[1] = [2, "<< /Type /Pages /Kids [<< /Type /Page /MediaBox [0 0 100 200] >>] /Count 1 >>"];
  let text = "%PDF-1.7\n"; const offsets = new Map<number, number>();
  for (const [number, body] of bodies) { offsets.set(number, text.length); text += `${number} 0 obj\n${body}\nendobj\n`; }
  const start = text.length; text += "xref\n0 1\n0000000000 65535 f \n";
  for (const number of [5, 4, 1, 2, 3]) text += `${number} 1\n${String(offsets.get(number)).padStart(10, "0")} 00000 n \n`;
  text += `trailer << /Root 1 0 R /Size 6 >>\nstartxref\n${start}\n%%EOF\n`;
  if (mode === "incremental") { const offset = text.length; text += "3 0 obj\n<< /Type /Page /MediaBox [0 0 222 333] >>\nendobj\n"; const xref = text.length; text += `xref\n3 1\n${String(offset).padStart(10, "0")} 00000 n \ntrailer << /Root 1 0 R /Size 6 /Prev ${start} >>\nstartxref\n${xref}\n%%EOF\n`; }
  if (mode === "repaired-order") text = text.slice(0, start) + "trailer << /Root 1 0 R /Size 6 >>\n%%EOF\n";
  const input = new TextEncoder().encode(text), args = ["in.pdf", "--json=2", "--json-key=pages", ...(mode === "zero-stream" ? ["--json-stream-data=file", "--json-stream-prefix=stream-"] : []), ...(mode === "default-prefix" ? ["--json-stream-data=file", "out.json"] : []), ...(mode === "replace-input" ? ["in.pdf"] : []), ...(mode === "missing-prefix" ? ["--json-stream-data=file"] : []), ...(mode === "empty-prefix" ? ["--json-stream-data=file", "--json-stream-prefix="] : [])];
  const files = new Map([["in.pdf", input]]), expected = await runQpdfCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  const guarded = new Proxy(fs, { get(target, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole JSON I/O"); }; const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
  const actual = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } } });
  assert.equal(actual.exitCode, expected.exitCode); assert.equal(Buffer.concat(stdout).toString(), expected.stdout); assert.equal(Buffer.concat(stderr).toString(), expected.stderr);
  for (const [name, bytes] of files) if (bytes !== input) assert.deepEqual(await fs.readFile(`/${name}`), bytes);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const mode of ["input-limit", "output-limit", "read", "write", "cancel", "sink", "late-decode"]) it(`cleans retained JSON after ${mode}`, async () => {
  const doc = PdfDocument.create(); doc.addPage();
  const stream = cosStream(new Uint8Array(131075).fill(199), { compress: false });
  if (mode === "late-decode") dictSet(stream.dict, "Filter", cosName("UnsupportedJsonFilter"));
  doc.cos.allocateObject(stream);
  const input = doc.save(), fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/out.json", new TextEncoder().encode("original"));
  const controller = new AbortController(), reason = new Error("injected JSON failure"); let reads = 0, writes = 0, published = 0;
  const guarded = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole JSON I/O"); };
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...args); if (args[0] !== "/in.pdf") return handle;
      return { ...handle, async read(...args: Parameters<typeof handle.read>) { reads++; if (mode === "read" && reads === 2) throw reason; if (mode === "cancel" && reads === 2) controller.abort(reason); return handle.read(...args); } };
    };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args); if (mode !== "write" || args[1] !== "output") return staged;
      return { ...staged, writer: { ...staged.writer!, async write() { throw reason; } } };
    };
    if (key === "publishStagedFile") return async (...args: Parameters<NonNullable<typeof fs.publishStagedFile>>) => { published++; return fs.publishStagedFile!(...args); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const args = ["in.pdf", "--json=2", "--json-stream-data=inline", ...(mode === "sink" ? [] : ["out.json"])], carrier = createCommandArguments(args);
  const expected = mode === "late-decode" ? await runQpdfCli(args, new Map([["in.pdf", input]])).catch(error => error as Error) : undefined;
  await assert.rejects(async () => createQpdfCommand({ limits: { maxInputBytes: mode === "input-limit" ? 1 : Infinity, maxOutputBytes: mode === "output-limit" ? 1 : Infinity } }).execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write() { writes++; if (mode === "sink") throw reason; } }, stderr: { async write() {} } }), error => mode.endsWith("limit") ? error instanceof Error && error.message.toLowerCase().includes("limit") : mode === "late-decode" ? error instanceof Error && expected instanceof Error && error.message === expected.message : error === reason);
  if (mode === "input-limit") assert.equal(reads, 0); assert.equal(published, 0); assert.equal(writes, mode === "sink" ? 1 : 0); assert.equal(new TextDecoder().decode(await fs.readFile("/out.json")), "original"); assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const count of [64, 256]) it(`bounds outstanding JSON writes for ${count} pages`, async () => {
  const doc = PdfDocument.create(); for (let i = 0; i < count; i++) doc.addPage().drawText(`page ${i}`, { x: 10, y: 20 });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", doc.save()); let outstanding = 0, peak = 0, output = 0;
  const guarded = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole JSON I/O"); };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer; if (!writer) return staged;
      return { ...staged, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) { assert.equal(outstanding, 0); outstanding += bytes.length; peak = Math.max(peak, bytes.buffer.byteLength); assert.ok(peak <= 65536); try { await Promise.resolve(); await writer.write(bytes, options); } finally { outstanding -= bytes.length; } } } };
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const args = ["in.pdf", "--json=2", "--json-key=pages", "--json-stream-data=inline"], carrier = createCommandArguments(args);
  const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes: Uint8Array) { assert.ok(bytes.buffer.byteLength <= 65536); output += bytes.length; await Promise.resolve(); } }, stderr: { async write() {} } });
  assert.equal(result.exitCode, 0); assert.ok(output > count * 100); assert.ok(peak > 0); assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const title of ["chapter", "", "decode-first"]) it(`preserves out-of-range JSON outline diagnostics for ${JSON.stringify(title)}`, async () => {
  const doc = PdfDocument.create(); doc.addPage(); doc.addPage();
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Outlines", cosDict({ First: cosDict({ Title: cosString(title), Dest: cosArray([cosNumber(1.9), cosName("Fit")]) }) }));
  if (title === "decode-first") { const stream = cosStream(new Uint8Array(10), { compress: false }); dictSet(stream.dict, "Filter", cosName("UnsupportedFirstFilter")); doc.cos.allocateObject(stream); }
  const input = doc.save(), args = ["in.pdf", "--json=2", "--json-stream-data=inline"], expected = await runQpdfCli(args, new Map([["in.pdf", input]])).catch(error => error as Error);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); const carrier = createCommandArguments(args); let writes = 0;
  await assert.rejects(async () => createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write() { writes++; } }, stderr: { async write() {} } }), error => error instanceof Error && expected instanceof Error && error.message === expected.message);
  assert.equal(writes, 0); assert.deepEqual(await fs.readdir("/scratch"), []);
});
