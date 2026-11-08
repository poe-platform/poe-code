import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createZipCodec } from "@poe-code/office-package";
import { parseXml } from "@poe-code/safe-fs/xml";
import { createEngine } from "../engine.js";
import type { CapabilityContext } from "../contracts.js";
import { createOdfWriter, readOdf } from "./odf.js";
import { decryptOdfEntries } from "./odf-encryption.js";
import { transformOdfBlowfish } from "./odf-blowfish.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha1 } from "@noble/hashes/legacy.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 100 } };
const book = { sheets: [{ id: "s", name: "Private", cells: [{ row: 0, column: 0, value: { kind: "number" as const, value: 42 } }] }],
  unsupportedRecords: [{ source: "Gnumeric_OpenCalc:openoffice", kind: "embedded-resource", disposition: "retained" as const,
    data: { path: "Pictures/private.bin", encoding: "hex", bytes: "00ff8001" } }] };
const zipLimits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };

describe.each(["blowfish-cfb8", "blowfish-cfb64"] as const)("%s encrypted ODF export", algorithm => {
  const options = [`encryption=odf12-${algorithm}`];
  it.each(["strict", "extended"] as const)("writes every %s ODF member with explicit Blowfish authority", async profile => {
    const secret = new TextEncoder().encode("owned output password"), borrowed: Uint8Array[] = [], before = structuredClone(book);
    const password = vi.fn(async () => secret), entropy = vi.fn(async (request: { length: number; signal: AbortSignal }) => {
      expect(request.length).toBe(24); expect(Object.isFrozen(request)).toBe(true);
      const bytes = Uint8Array.from({ length: request.length }, (_, i) => borrowed.length * 37 + i);
      borrowed.push(bytes); return bytes;
    });
    const bytes = await createOdfWriter(profile)(book, options, { ...context, password: { read: password }, entropy: { read: entropy } });
    expect(password).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ purpose: "encrypt", algorithm, encoding: "utf8" }));
    const zip = createZipCodec(), archive = await zip.readZipArchive(bytes, zipLimits, context.signal);
    async function readEntry(name: string) {
      const entry = archive.entries.find(e => e.name === name)!, chunks: Uint8Array[] = [];
      for await (const chunk of zip.decodeZipEntry(entry, zipLimits, context.signal)) chunks.push(new Uint8Array(chunk));
      return new Uint8Array(Buffer.concat(chunks));
    }
    const manifest = parseXml(new TextDecoder().decode(await readEntry("META-INF/manifest.xml")));
    const attr = (node: typeof manifest, name: string) => node.attributes.find(a => a.localName === name)!.value;
    const members = manifest.children.filter(n => n.children.some(c => c.localName === "encryption-data"));
    expect(members.map(n => attr(n, "full-path")).sort()).toEqual(["Pictures/private.bin", "content.xml", "meta.xml", "settings.xml", "styles.xml"]);
    for (const member of members) {
      const declaration = member.children.find(c => c.localName === "encryption-data")!;
      expect(attr(declaration, "checksum-type")).toBe("SHA1/1K");
      const cipher = declaration.children.find(c => c.localName === "algorithm")!;
      expect(attr(cipher, "algorithm-name")).toBe("Blowfish CFB");
      expect(Buffer.from(attr(cipher, "initialisation-vector"), "base64")).toHaveLength(8);
      const derivation = declaration.children.find(c => c.localName === "key-derivation")!;
      expect(attr(derivation, "key-size")).toBe("16"); expect(attr(derivation, "iteration-count")).toBe("1024");
      const start = declaration.children.find(c => c.localName === "start-key-generation")!;
      expect(attr(start, "start-key-generation-name")).toBe("http://www.w3.org/2000/09/xmldsig#sha1");
      expect(attr(start, "key-size")).toBe("20");
      const key = pbkdf2(sha1, sha1(secret), Buffer.from(attr(derivation, "salt"), "base64"), { c: 1024, dkLen: 16 });
      const compressed = await transformOdfBlowfish(key, Buffer.from(attr(cipher, "initialisation-vector"), "base64"),
        await readEntry(attr(member, "full-path")), context.signal, "decrypt", algorithm === "blowfish-cfb8" ? 1 : 8);
      expect(Buffer.from(sha1(compressed.subarray(0, 1024))).toString("base64")).toBe(attr(declaration, "checksum"));
      key.fill(0); compressed.fill(0);
      expect(archive.entries.find(e => e.name === attr(member, "full-path"))!.method).toBe(0);
    }
    const reopened = await readOdf(bytes, { ...context, password: { read: async () => secret } });
    expect(reopened.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
    // The reader retains only referenced objects; still verify this encrypted member.
    const decrypted = await decryptOdfEntries(manifest, new Map(archive.entries.map(e => [e.name, e])), readEntry,
      { ...context, password: { read: async () => secret } }, () => {}, 100000, 100000);
    expect(decrypted.get("Pictures/private.bin")).toEqual(new Uint8Array([0, 255, 128, 1]));
    expect(borrowed).toHaveLength(5); borrowed.forEach((v, n) => expect(v).toEqual(Uint8Array.from({ length: 24 }, (_, i) => n * 37 + i)));
    expect(secret).toEqual(new TextEncoder().encode("owned output password")); expect(book).toEqual(before);
  });

  it.each(["missing-password", "missing-entropy", "declined", "bad-entropy", "entropy-error", "work", "cancel"])("preserves the existing destination on Blowfish %s refusal", async mode => {
    const volume = Volume.fromJSON({ "/output.ods": "untouched" }), controller = new AbortController();
    const password = vi.fn(async () => mode === "declined" ? undefined : "owned output password");
    const entropy = vi.fn(async ({ length }: { length: number }) => {
      if (mode === "entropy-error") throw new Error("private callback text");
      if (mode === "cancel") setTimeout(() => controller.abort(false), 0);
      return new Uint8Array(mode === "bad-entropy" ? 48 : length);
    });
    const write = vi.fn(async (uri: string, bytes: Uint8Array) => { volume.writeFileSync(uri, bytes); });
    const engine = createEngine({ codecs: [], environment: context.environment,
      limits: mode === "work" ? { ...context.limits, workbookWork: 500000 } : context.limits,
      ...(mode === "missing-password" ? {} : { password: { read: password } }),
      ...(mode === "missing-entropy" ? {} : { entropy: { read: entropy } }),
      filesystem: { async read() { return []; }, write } });
    try {
      const operation = engine.convert({ input: { kind: "stream", filename: "input.csv", source: [new TextEncoder().encode("42\n")] },
        destination: { kind: "resource", uri: "/output.ods" }, exportType: "Gnumeric_OpenCalc:odf", exportOptions: options }, { signal: controller.signal });
      if (mode === "cancel") await expect(operation).rejects.toBe(false);
      else await expect(operation).rejects.toMatchObject({ code: mode === "work" ? "resource-limit" : "unsupported-feature" });
      if (["missing-password", "missing-entropy", "work"].includes(mode)) { expect(password).not.toHaveBeenCalled(); expect(entropy).not.toHaveBeenCalled(); }
      expect(write).not.toHaveBeenCalled(); expect(volume.readFileSync("/output.ods", "utf8")).toBe("untouched");
    } finally { await engine.dispose(); }
  });

  it.each(["openoffice", "odf"])("exposes encrypted Blowfish export through public %s SDK options", async exporter => {
    const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
      password: { read: async () => "owned test password" }, entropy: { read: async ({ length }) => new Uint8Array(length) } });
    const chunks: Uint8Array[] = [];
    try {
      const result = await engine.convert({ input: { kind: "stream", filename: "input.csv", source: [new TextEncoder().encode("42\n")] },
        destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } },
        exportType: `Gnumeric_OpenCalc:${exporter}`, exportOptions: options }, context);
      expect(result.exitCode).toBe(0);
      expect((await engine.readWorkbook({ kind: "stream", filename: "result.ods", source: chunks }, {}, context)).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
    } finally { await engine.dispose(); }
  });
});
