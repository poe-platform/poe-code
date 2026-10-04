import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { FsError } from "safe-bash-contracts/errors";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const json = JSON.stringify({ objects: {
  "obj:1 0 R": { value: { "/Type": "/Catalog", "/Pages": "2 0 R" } },
  "obj:2 0 R": { value: { "/Type": "/Pages", "/Count": 0, "/Kids": [] } },
  trailer: { value: { "/Root": "1 0 R" } }
} });
for (const mode of ["input", "update", "both", "stdin", "empty", "missing", "root", "datafile", "inline", "invalid", "inspect", "predicate"]) it(`streams qpdf JSON ${mode} with legacy bytes and cleanup`, async () => {
  const pdf = PdfDocument.create(); pdf.addPage();
  const files = new Map([["in.pdf", pdf.save()], ["in.json", encode(mode === "invalid" ? '{"objects":' : mode === "root" ? '{"objects":{}}' : json)],
    ["update.json", encode(JSON.stringify({ objects: { "obj:8 0 R": mode === "datafile" ? { stream: { dict: {}, datafile: "data.bin" } } : mode === "inline" ? { stream: { dict: {}, data: "cQpRCg==" } } : { value: { "/Title": "u:更新😀" } }, trailer: { value: { "/Info": "8 0 R" } } } }))], ["data.bin", encode("q\nQ\n")]]);
  const args = mode === "update" || mode === "datafile" || mode === "inline" || mode === "missing" ? ["in.pdf", "out.pdf", `--update-from-json=${mode === "missing" ? "missing.json" : "update.json"}`]
    : mode === "empty" ? ["--empty", "out.pdf", "--update-from-json=update.json"]
    : [mode === "stdin" ? "-" : "in.json", "out.pdf", "--json-input", ...(mode === "both" ? ["--update-from-json=update.json"] : []), ...(mode === "inspect" ? ["--show-npages"] : []), ...(mode === "predicate" ? ["--is-encrypted"] : [])];
  const expectedFiles = new Map(files); if (mode === "stdin") expectedFiles.set("-", files.get("in.json")!);
  const expected = await runQpdfCli(args, expectedFiles);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
  let pending = 0, peak = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file JSON I/O forbidden"); };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer; if (!writer) return staged;
      return { ...staged, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        pending += bytes.length; peak = Math.max(peak, pending);
        try { await Promise.resolve(); return await writer.write(bytes, options); } finally { pending -= bytes.length; }
      } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const carrier = createCommandArguments(args), errors: Uint8Array[] = [], output: Uint8Array[] = [];
  const actual = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: new AbortController().signal, stdin: (async function* () { if (mode === "stdin") yield files.get("in.json")!; })(), stdout: { async write(bytes) { output.push(bytes.slice()); } }, stderr: { async write(bytes) { errors.push(bytes.slice()); } } });
  assert.equal(actual.exitCode, expected.exitCode); assert.equal(Buffer.concat(errors).toString(), expected.stderr); assert.equal(Buffer.concat(output).toString(), expected.stdout);
  if (expectedFiles.has("out.pdf")) assert.deepEqual(await fs.readFile("/out.pdf"), expectedFiles.get("out.pdf"));
  assert.equal(pending, 0); assert.ok(peak <= 65536); assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const option of [[], ["--qdf"], ["--linearize"], ["--object-streams=generate"], ["--json"], ["--show-pages"], ["--show-object=1"], ["--show-xref"], ["--check"], ["--split-pages"], ["--rotate=90:1"], ["--remove-info"], ["--pages", "in.pdf", "1,1", "--"], ["--encrypt", "secret", "owner", "128", "--"]]) it(`imports native-shaped JSON then applies ${option.join(" ") || "default output"}`, async t => {
  let random = 0;
  if (option.includes("--encrypt")) t.mock.method(crypto, "getRandomValues", <T extends ArrayBufferView | null>(value: T): T => {
    if (!value) throw new Error("Missing random target");
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    for (let at = 0; at < bytes.length; at++) bytes[at] = random++ % 251;
    return value;
  });
  const pdf = PdfDocument.create(); pdf.addPage().drawText("Round trip", { x: 20, y: 30 });
  const exported = await runQpdfCli(["in.pdf", "--json", "--json-stream-data=inline"], new Map([["in.pdf", pdf.save()]]));
  const input = encode(exported.stdout), update = encode('{"objects":{"obj:8 0 R":{"value":{"/Title":"u:updated"}},"trailer":{"value":{"/Info":"8 0 R"}}}}');
  const args = ["in.json", "out.pdf", "--json-input", "--update-from-json=update.json", ...option];
  const files = new Map([["in.json", input], ["update.json", update], ["in.pdf", pdf.save()]]), expected = await runQpdfCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.json", input); await fs.writeFile("/update.json", update); await fs.writeFile("/in.pdf", files.get("in.pdf")!);
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file JSON I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args), output: Uint8Array[] = [], errors: Uint8Array[] = [];
  random = 0;
  const actual = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write(bytes) { output.push(bytes.slice()); } }, stderr: { async write(bytes) { errors.push(bytes.slice()); } } });
  assert.equal(actual.exitCode, expected.exitCode); assert.equal(Buffer.concat(errors).toString(), expected.stderr); assert.equal(Buffer.concat(output).toString(), expected.stdout);
  for (const [name, bytes] of files) if (name !== "in.json" && name !== "update.json") assert.deepEqual(await fs.readFile(`/${name}`), bytes);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const mode of ["slow", "cancel", "write", "input-limit", "output-limit"]) it(`bounds generated JSON input and preserves publication on ${mode}`, async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/out.pdf", encode("original"));
  const controller = new AbortController(), reason = new Error("cancel JSON"), chunk = encode("cQpRCgAA".repeat(512));
  let outstanding = 0, peak = 0, writes = 0, opened = 0, closed = 0, output = 0, injected = false;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file JSON I/O forbidden"); };
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...args); opened++;
      return { ...handle, async close() { closed++; await handle.close(); } };
    };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer; if (!writer) return staged;
      return { ...staged, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        outstanding += bytes.length; peak = Math.max(peak, outstanding); writes++;
        assert.ok(bytes.buffer.byteLength <= 65536);
        try {
          if (!injected && new TextDecoder().decode(bytes.subarray(0, 8)).startsWith("%PDF-")) {
            if (mode === "cancel") { injected = true; controller.abort(reason); }
            if (mode === "write") { injected = true; throw new FsError("EIO", { message: "JSON staging I/O failed" }); }
          }
          await Promise.resolve(); return await writer.write(bytes, options);
        } finally { outstanding -= bytes.length; }
      } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const carrier = createCommandArguments(["-", mode === "slow" ? "-" : "out.pdf", "--json-input"]);
  const execute = async () => createQpdfCommand({ limits: mode === "input-limit" ? { maxInputBytes: 10000 } : mode === "output-limit" ? { maxOutputBytes: 10 } : {} }).execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: controller.signal, stdin: (async function* () {
      yield encode(json.slice(0, -2) + ',"obj:9 0 R":{"stream":{"dict":{},"data":"');
      for (let n = 0; n < 32; n++) yield chunk;
      yield encode('"}}}}');
    })(), stdout: { async write(bytes) { output += bytes.length; await Promise.resolve(); } }, stderr: { async write() {} } });
  if (mode === "slow") { assert.equal((await execute()).exitCode, 0); assert.ok(output > 90000); }
  else await assert.rejects(execute, error => mode === "cancel" ? error === reason : mode === "write" ? error instanceof FsError && error.code === "EIO" : error instanceof Error && error.message.toLowerCase().includes("limit"));
  assert.equal(injected, mode === "cancel" || mode === "write"); assert.equal(opened, closed); assert.equal(outstanding, 0); assert.ok(peak <= 65536); assert.ok(writes > 1);
  assert.deepEqual(await fs.readFile("/out.pdf"), encode("original")); assert.deepEqual(await fs.readdir("/scratch"), []);
});
