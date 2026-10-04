import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosStream } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["ordinary", "objects", "linearize", "permissions", "empty", "flatten", "split", "decrypt", "large", "slow", "inline-qdf", "inline-uncompress", "inline-objects-qdf", "inline-normalize"]) it(`encrypts ${mode} output through caller storage`, async () => {
  const doc = PdfDocument.create(); doc.setTitle("Encrypted title"); const page = doc.addPage(); page.setRotation(90);
  if (mode !== "empty") page.setRawContentStream("1 0 0 rg 10 20 30 40 re f\n".repeat(3000));
  if (mode === "large" || mode === "slow") doc.cos.allocateObject(cosStream(new Uint8Array(mode === "large" ? 1048579 : 65539).fill(199)));
  if (mode.startsWith("inline")) page.setRawContentStream("BI /W 2 /H 1 /BPC 8 /CS /RGB ID abcdef EI");
  const input = doc.save(), args = ["in.pdf", "out.pdf", "--encrypt", "reader", "owner", "256", ...(mode === "permissions" ? ["--print=none", "--modify=none", "--extract=n"] : []), "--", ...((mode === "objects" || mode === "inline-objects-qdf") ? ["--object-streams=generate"] : []), ...(mode === "linearize" ? ["--linearize"] : []), ...(mode === "flatten" ? ["--flatten-rotation"] : []), ...(mode === "split" ? ["--split-pages"] : []), ...(mode === "decrypt" ? ["--decrypt"] : []), ...(mode.startsWith("inline") ? ["--externalize-inline-images", "--ii-min-bytes=1", mode === "inline-uncompress" ? "--stream-data=uncompress" : mode === "inline-normalize" ? "--normalize-content=y" : "--qdf"] : [])];
  const original = crypto.getRandomValues; let counter = 0;
  Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: <T extends ArrayBufferView | null>(value: T): T => { if (!value) throw new Error("Missing random target"); const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength); for (let i = 0; i < bytes.length; i++) bytes[i] = counter++ % 251; return value; } });
  try {
    const files = new Map([["in.pdf", input]]), expected = await runQpdfCli(args, files);
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
    let outstanding = 0, peak = 0, opened = 0, closed = 0;
    const guarded = new Proxy(fs, { get(owner, key) {
      if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
        const handle = await fs.open!(...args); opened++;
        return new Proxy(handle, { get(target, property) {
          if (property === "write") return async (...args: Parameters<typeof handle.write>) => {
            const size = args[0].byteLength; outstanding += size; peak = Math.max(peak, outstanding);
            try { if (mode === "slow") await new Promise(resolve => setTimeout(resolve, 1)); return await handle.write(...args); }
            finally { outstanding -= size; }
          };
          if (property === "close") return async () => { closed++; await handle.close(); };
          const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
        } });
      }; if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file encryption I/O"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
    const carrier = createCommandArguments(args), errors: Uint8Array[] = []; counter = 0;
    const actual = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes.slice()); } } });
    assert.equal(actual.exitCode, expected.exitCode); assert.equal(Buffer.concat(errors).toString(), expected.stderr);
    for (const [name, bytes] of files) if (name !== "in.pdf") assert.deepEqual(await fs.readFile(`/${name}`), bytes);
    assert.deepEqual(await fs.readdir("/scratch"), []);
    assert.equal(opened, closed); assert.equal(outstanding, 0); assert.ok(peak <= 65536);
  } finally { Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: original }); }
});
