import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand } from "./index.js";

for (const mode of ["lines", "input-limit", "expanded-limit", "cancel", "missing", "nested", "read"]) it(`reads argument files through retained ranges (${mode})`, async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const doc = PdfDocument.create(); doc.addPage(); const pdf = doc.save(); await fs.writeFile("/é.pdf", pdf);
  const text = mode === "nested" ? "@nested\n" : `${"\n".repeat(16383)}é.pdf\r\n\n--show-npages\r\n`;
  const encoded = new TextEncoder().encode(text); if (mode !== "missing") await fs.writeFile("/args", encoded);
  let reads = 0, closes = 0, largest = 0; const controller = new AbortController(), reason = new Error("cancel argument read");
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file argument I/O forbidden"); };
    if (key === "openReadFile") return async (...params: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...params); if (params[0] !== "/args") return handle;
      return { ...handle, async read(...range: Parameters<typeof handle.read>) { reads++; if (mode === "read") throw new Error("broken range read"); largest = Math.max(largest, range[1]); if (mode === "cancel") controller.abort(reason); return handle.read(...range); }, async close() { closes++; await handle.close(); } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const carrier = createCommandArguments(["@args"]), stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const run = async () => createQpdfCommand({ limits: mode === "input-limit" ? { maxInputBytes: encoded.length - 1 } : mode === "expanded-limit" ? { maxArgumentBytes: 10 } : {} }).execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
  if (mode === "cancel") await assert.rejects(run, error => error === reason);
  else if (mode.endsWith("limit")) await assert.rejects(run, /byte limit exceeded/i);
  else { const result = await run(); assert.equal(result.exitCode, mode === "lines" ? 0 : 2); if (mode === "lines") assert.equal(Buffer.concat(stdout).toString(), "1\n"); else assert.match(Buffer.concat(stderr).toString(), (mode === "missing" || mode === "read") ? /cannot open args/ : /@nested/); }
  if (mode === "input-limit") assert.equal(reads, 0);
  assert.ok(largest <= 16384); assert.equal(closes, mode === "missing" ? 0 : 1); assert.deepEqual(await fs.readdir("/scratch"), []);
});
