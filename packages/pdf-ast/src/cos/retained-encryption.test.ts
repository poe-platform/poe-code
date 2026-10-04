import { it, expect, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { cosStream } from "../ast.js";
import { PdfFileSource } from "../source.js";
import { parseCosDocument } from "./parser.js";
import { encryptCosDocument } from "./security.js";
import { encryptRetainedPdfChunks } from "./retained-encryption.js";

for (const revision of [3, 6] as const) it.each([0, 1, 15, 16, 16384, 16385, 65539])(`matches revision ${revision} encryption for %i stream bytes`, async length => {
  const input = PdfDocument.create(); input.addPage(); input.setTitle("Encrypted title"); input.cos.allocateObject(cosStream(new Uint8Array(length).fill(199)));
  const bytes = input.save(), fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", bytes);
  let counter = 0;
  const random = vi.spyOn(crypto, "getRandomValues").mockImplementation(array => { if (!array) throw new Error("Missing random target"); const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength); for (let i = 0; i < bytes.length; i++) bytes[i] = counter++ % 251; return array; });
  const source = await PdfFileSource.open(fs, "/input"), options = { revision, userPassword: "reader", ownerPassword: "owner" };
  try {
    const expected = encryptCosDocument(parseCosDocument(bytes), options); counter = 0;
    const chunks = []; for await (const bytes of encryptRetainedPdfChunks(source, { fs, directory: "/scratch" }, options)) { expect(bytes.byteLength).toBeLessThanOrEqual(65536); chunks.push(bytes); }
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected);
    expect(PdfDocument.load(expected, { password: "reader" }).getMetadata().title).toBe("Encrypted title");
    expect(await fs.readdir("/scratch")).toEqual([]);
  } finally { random.mockRestore(); await source.close(); }
});

it.each(["entropy", "cancel", "limit", "return"])("cleans retained encryption after %s", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const input = PdfDocument.create(); input.addPage(); input.setTitle("title"); await fs.writeFile("/input", input.save());
  const source = await PdfFileSource.open(fs, "/input"), controller = new AbortController(), reason = new Error("Encryption failed");
  const original = crypto.getRandomValues.bind(crypto); let calls = 0;
  const random = vi.spyOn(crypto, "getRandomValues").mockImplementation(array => { if (++calls === 6) { if (mode === "entropy") throw reason; if (mode === "cancel") controller.abort(reason); } return original(array); });
  try {
    const output = encryptRetainedPdfChunks(source, { fs, directory: "/scratch" }, { signal: controller.signal, ...(mode === "limit" ? { maxOutputBytes: 1 } : {}) });
    const consuming = (async () => { for await (const ignored of output) { void ignored; if (mode === "return") break; } })();
    if (mode === "entropy" || mode === "cancel") await expect(consuming).rejects.toBe(reason);
    else if (mode === "limit") await expect(consuming).rejects.toThrow("limit");
    else await consuming;
    expect(await fs.readdir("/scratch")).toEqual([]);
    expect(await source.read(0, 5)).toEqual(new TextEncoder().encode("%PDF-"));
  } finally { random.mockRestore(); await source.close(); }
});
