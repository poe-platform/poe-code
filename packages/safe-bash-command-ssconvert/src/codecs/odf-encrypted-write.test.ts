import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createZipCodec } from "@poe-code/office-package";
import { parseXml } from "@poe-code/safe-fs/xml";
import { createEngine } from "../engine.js";
import type { CapabilityContext, EngineConfig, PasswordCapability, CryptographicEntropyCapability } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { createOdfWriter, readOdf } from "./odf.js";

const book: Workbook = { sheets: [{ id: "s", name: "Secret", cells: [
  { row: 0, column: 0, value: { kind: "string", value: "confidential cell" } }
] }], unsupportedRecords: [{ source: "Gnumeric_OpenCalc:openoffice", kind: "embedded-resource", disposition: "retained",
  data: { path: "Pictures/private.png", encoding: "hex", bytes: "01020304" } }] };
const base: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 100 } };
const zipLimits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
function bindings() {
  const secret = new TextEncoder().encode("original test password"), borrowed: Uint8Array[] = [];
  const read = vi.fn(async (_request: Parameters<PasswordCapability["read"]>[0]) => secret);
  const entropy = vi.fn(async (request: { length: number; signal: AbortSignal }) => {
    expect(Object.isFrozen(request)).toBe(true);
    const bytes = Uint8Array.from({ length: request.length }, (_, i) => (borrowed.length * 53 + i) % 256);
    borrowed.push(bytes); return bytes;
  });
  return { secret, borrowed, read, entropy, context: { ...base, password: { read }, entropy: { read: entropy } } };
}
it("round-trips ODF passwords beyond the former implicit byte ceiling", async () => {
  const binding = bindings(), password = "p".repeat(4097);
  const read = vi.fn(async (_request: Parameters<PasswordCapability["read"]>[0]) => password), context = { ...binding.context, password: { read } };
  const bytes = await createOdfWriter("strict")(book, ["encryption=odf12-aes128-cbc"], context);
  expect((await readOdf(bytes, context)).sheets[0]!.cells[0]!.value).toEqual(book.sheets[0]!.cells[0]!.value);
  expect(read).toHaveBeenCalledTimes(2);
  for (const [request] of read.mock.calls)
    expect(request.maxBytes).toBe(context.limits.inputBytes);
});
async function unpack(bytes: Uint8Array) {
  const zip = createZipCodec(), archive = await zip.readZipArchive(bytes, zipLimits, base.signal);
  const parts = new Map<string, Uint8Array>();
  for (const entry of archive.entries) {
    const chunks = [];
    for await (const chunk of zip.decodeZipEntry(entry, zipLimits, base.signal)) chunks.push(new Uint8Array(chunk));
    parts.set(entry.name, new Uint8Array(Buffer.concat(chunks)));
  }
  return { archive, parts };
}
describe.each([128, 192, 256])("ODF AES-%i encrypted export", bits => {
  const options = [`encryption=odf12-aes${bits}-cbc`];
  const insufficientWork = bits === 128 ? 500000 : 1000000;
  it.each(["strict", "extended"] as const)("independently decrypts every %s export member to exact plaintext bytes", async profile => {
    const b = bindings(), writer = createOdfWriter(profile), before = structuredClone(book);
    const plain = await unpack(await writer(book, [], base));
    const encrypted = await unpack(await writer(book, options, { ...b.context, outputFilename: "/private.ods" }));
    expect(b.read).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ purpose: "encrypt", outputFilename: "/private.ods",
      format: "odf", algorithm: "aes-cbc", revision: "1.2", encoding: "utf8" }));
    expect(Object.isFrozen(b.read.mock.calls[0]![0])).toBe(true);
    const manifest = parseXml(new TextDecoder().decode(encrypted.parts.get("META-INF/manifest.xml")!));
    const salts = new Set(), ivs = new Set();
    for (const entry of encrypted.archive.entries) {
      if (entry.name === "mimetype" || entry.name === "META-INF/manifest.xml") continue;
      expect(entry.method).toBe(0);
      const declaration = manifest.children.find(n => n.attributes.some(a => a.localName === "full-path" && a.value === entry.name))!;
      const attr = (node: typeof manifest, name: string) => node.attributes.find(a => a.localName === name)!.value;
      expect(Number(attr(declaration, "size"))).toBe(plain.parts.get(entry.name)!.length);
      const encryption = declaration.children.find(n => n.localName === "encryption-data")!;
      const algorithm = encryption.children.find(n => n.localName === "algorithm")!;
      const kdf = encryption.children.find(n => n.localName === "key-derivation")!;
      const start = encryption.children.find(n => n.localName === "start-key-generation")!;
      expect(attr(algorithm, "algorithm-name")).toBe(`http://www.w3.org/2001/04/xmlenc#aes${bits}-cbc`);
      expect(attr(kdf, "key-size")).toBe(String(bits / 8));
      expect(attr(kdf, "iteration-count")).toBe("1024");
      expect(attr(start, "start-key-generation-name")).toBe("http://www.w3.org/2000/09/xmldsig#sha256");
      expect(attr(start, "key-size")).toBe("32");
      const salt = Buffer.from(attr(kdf, "salt"), "base64"), iv = Buffer.from(attr(algorithm, "initialisation-vector"), "base64");
      salts.add(salt.toString("hex")); ivs.add(iv.toString("hex"));
      const key = pbkdf2Sync(createHash("sha256").update(b.secret).digest(), salt, 1024, bits / 8, "sha1");
      const decipher = createDecipheriv(`aes-${bits}-cbc`, key, iv).setAutoPadding(false);
      const padded = Buffer.concat([decipher.update(encrypted.parts.get(entry.name)!), decipher.final()]);
      const padding = padded.at(-1)!; expect(padding).toBeGreaterThan(0); expect(padding).toBeLessThanOrEqual(16);
      const compressed = padded.subarray(0, -padding);
      expect(createHash("sha256").update(compressed.subarray(0, 1024)).digest("base64")).toBe(attr(encryption, "checksum"));
      expect(new Uint8Array(inflateRawSync(compressed))).toEqual(plain.parts.get(entry.name));
      expect(new TextDecoder().decode(encrypted.parts.get(entry.name))).not.toContain("confidential cell");
    }
    expect(salts.size).toBe(5); expect(ivs.size).toBe(5);
    expect(b.secret).toEqual(new TextEncoder().encode("original test password"));
    b.borrowed.forEach((bytes, n) => expect(bytes).toEqual(Uint8Array.from({ length: bytes.length }, (_, i) => (n * 53 + i) % 256)));
    expect((await readOdf(await writer(book, options, b.context), b.context)).sheets[0]!.cells[0]!.value).toEqual(book.sheets[0]!.cells[0]!.value);
    expect(book).toEqual(before);
  });
  it("rejects a wrong password for actual encrypted output", async () => {
    const b = bindings(), bytes = await createOdfWriter("extended")(book, options, b.context);
    await expect(readOdf(bytes, { ...b.context, password: { read: async () => "wrong password" } }))
      .rejects.toMatchObject({ code: "io", message: "E Invalid OpenDocument: encrypted content could not be verified" });
  });
  it.each(["password", "entropy"] as const)("requires explicit %s authority without falling back to statistical randomness", async missing => {
    const b = bindings(), random = vi.fn(() => 0.5), context = { ...base, random: { next: random },
      ...(missing === "password" ? { entropy: b.context.entropy } : { password: b.context.password }) };
    await expect(createOdfWriter("extended")(book, options, context)).rejects.toMatchObject({ code: "unsupported-feature" });
    expect(b.read).not.toHaveBeenCalled(); expect(b.entropy).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled();
  });
  it.each([undefined, "\ud800", new Uint8Array([255]), new Uint8Array(4097)])("refuses unavailable or invalid output secrets", async secret => {
    const b = bindings();
    await expect(createOdfWriter("extended")(book, options, { ...b.context, limits: { ...b.context.limits, inputBytes: 4096 }, password: { read: async () => secret } })).rejects.toMatchObject({ code: "unsupported-feature" });
    expect(b.entropy).not.toHaveBeenCalled();
  });
  it.each([undefined, new Uint8Array(1), new Uint8Array(49)])("refuses declined or incorrectly sized entropy", async bytes => {
    const b = bindings();
    await expect(createOdfWriter("extended")(book, options, { ...b.context, entropy: { read: async () => bytes } })).rejects.toMatchObject({ code: "unsupported-feature" });
  });
  it.each(["password", "entropy"] as const)("observes falsey cancellation after %s awaits", async port => {
    const b = bindings(), controller = new AbortController();
    const context: CapabilityContext = { ...b.context, signal: controller.signal,
      ...(port === "password" ? { password: { async read() { controller.abort(false); return b.secret; } } }
        : { entropy: { async read() { controller.abort(false); return new Uint8Array(48); } } }) };
    await expect(createOdfWriter("extended")(book, options, context)).rejects.toBe(false);
  });
  it("admits aggregate KDF work before either authority", async () => {
    const b = bindings();
    await expect(createOdfWriter("extended")(book, options, { ...b.context, limits: { ...base.limits, workbookWork: insufficientWork } })).rejects.toMatchObject({ code: "resource-limit" });
    expect(b.read).not.toHaveBeenCalled(); expect(b.entropy).not.toHaveBeenCalled();
  });
  it("keeps plaintext exports deterministic and does not acquire secrets unless requested", async () => {
    const b = bindings();
    expect(await createOdfWriter("extended")(book, [], b.context)).toEqual(await createOdfWriter("extended")(book, [], base));
    expect(b.read).not.toHaveBeenCalled(); expect(b.entropy).not.toHaveBeenCalled();
  });
  it.each(["openoffice", "odf"])("snapshots host methods and exposes the %s opt-in through the public SDK", async exporter => {
    const b = bindings(), password: PasswordCapability = b.context.password, entropy: CryptographicEntropyCapability = b.context.entropy;
    const config: EngineConfig = { environment: base.environment, limits: base.limits, password, entropy, codecs: [] };
    const engine = createEngine(config), chunks: Uint8Array[] = [];
    password.read = async () => { throw new Error("replaced secret"); };
    entropy.read = async () => { throw new Error("replaced entropy"); };
    try {
      const owned = await engine.readWorkbook({ kind: "stream", filename: "source.csv", source: [new TextEncoder().encode("42\n")] }, {}, base);
      const result = await engine.writeWorkbook(owned, { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } },
        { exportType: `Gnumeric_OpenCalc:${exporter}`, exportOptions: options }, base);
      expect(result.exitCode).toBe(0); expect(chunks).toHaveLength(1);
      const reopened = await engine.readWorkbook({ kind: "stream", filename: "result.ods", source: chunks }, {}, base);
      expect(reopened.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
    } finally { await engine.dispose(); }
  });

  it.each(["declined", "secret-error", "entropy-error", "bad-entropy", "cancel-kdf", "work-limit"])("preserves an existing destination on %s", async mode => {
    const b = bindings(), controller = new AbortController(), volume = Volume.fromJSON({ "/output.ods": "untouched" });
    let writes = 0;
    const engine = createEngine({ codecs: [], environment: base.environment,
      limits: mode === "work-limit" ? { ...base.limits, workbookWork: insufficientWork } : base.limits,
      password: { async read() {
        if (mode === "declined") return undefined;
        if (mode === "secret-error") throw new Error("sensitive callback text");
        return b.secret;
      } }, entropy: { async read(request) {
        if (mode === "entropy-error") throw new Error("sensitive callback text");
        if (mode === "bad-entropy") return new Uint8Array(2);
        if (mode === "cancel-kdf") setTimeout(() => controller.abort(false), 0);
        return b.entropy(request);
      } }, filesystem: { async read() { return []; }, async write(uri, bytes) { writes++; volume.writeFileSync(uri, bytes); } } });
    try {
      const owned = await engine.readWorkbook({ kind: "stream", filename: "source.csv", source: [new TextEncoder().encode("42\n")] }, {}, base);
      const operation = engine.writeWorkbook(owned, { kind: "resource", uri: "/output.ods" },
        { exportType: "Gnumeric_OpenCalc:odf", exportOptions: options }, { signal: controller.signal });
      if (mode === "cancel-kdf") await expect(operation).rejects.toBe(false);
      else await expect(operation).rejects.toMatchObject({ code: mode === "work-limit" ? "resource-limit" : "unsupported-feature" });
      expect(writes).toBe(0); expect(volume.readFileSync("/output.ods", "utf8")).toBe("untouched");
    } finally { await engine.dispose(); }
  });
});

it.each(["odf12-aes64-cbc", "odf12-aes128-gcm", "aes192-cbc", "", "__proto__", "constructor"])("rejects invalid profile %j before secrets or publication", async profile => {
  const b = bindings(), write = vi.fn(), engine = createEngine({ codecs: [], environment: base.environment,
    limits: base.limits, password: b.context.password, entropy: b.context.entropy });
  try {
    const owned = await engine.readWorkbook({ kind: "stream", filename: "source.csv", source: [new TextEncoder().encode("42\n")] }, {}, base);
    for (const exporter of ["openoffice", "odf"]) {
      await expect(engine.writeWorkbook(owned, { kind: "stream", sink: { write } },
        { exportType: `Gnumeric_OpenCalc:${exporter}`, exportOptions: [`encryption=${profile}`] }, base))
        .rejects.toMatchObject({ code: "invalid-request" });
    }
    for (const profileName of ["strict", "extended"] as const) {
      await expect(createOdfWriter(profileName)(book, [`encryption=${profile}`], b.context))
        .rejects.toMatchObject({ code: "invalid-request" });
    }
    expect(b.read).not.toHaveBeenCalled(); expect(b.entropy).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  } finally { await engine.dispose(); }
});
