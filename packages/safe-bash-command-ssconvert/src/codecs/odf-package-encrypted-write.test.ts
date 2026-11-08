import { createDecipheriv, createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { beforeEach, expect, it, vi } from "vitest";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { createZipCodec } from "@poe-code/office-package";
import { parseXml } from "@poe-code/safe-fs/xml";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import type { CapabilityContext } from "../contracts.js";
import { createOdfWriter, readOdf } from "./odf.js";

// The real 64 MiB KDF is exercised by manual interoperability QA. Unit tests
// assert its admitted inputs and independently authenticate the resulting GCM.
vi.mock("@noble/hashes/argon2.js", () => ({ argon2idAsync: vi.fn() }));
beforeEach(() => { vi.mocked(argon2idAsync).mockReset().mockImplementation(async () => new Uint8Array(32).fill(0x47)); });
const options = ["encryption=libreoffice-aes256-gcm"];
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 100, workbookWork: 256 * 1024 * 1024 } };
const book = { sheets: [{ id: "s", name: "Private", cells: [{ row: 0, column: 0, value: { kind: "number" as const, value: 42 } }] }],
  unsupportedRecords: [{ source: "Gnumeric_OpenCalc:openoffice", kind: "embedded-resource", disposition: "retained" as const,
    data: { path: "Pictures/private.bin", encoding: "hex", bytes: "00ff8001" } }] };
const zipLimits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
function bindings() {
  const secret = new TextEncoder().encode("海\0🌊"), borrowed = Uint8Array.from({ length: 28 }, (_, i) => i);
  const password = vi.fn(async () => secret), entropy = vi.fn(async () => borrowed);
  return { secret, borrowed, password, entropy, context: { ...context, password: { read: password }, entropy: { read: entropy } } };
}
async function unpack(bytes: Uint8Array) {
  const zip = createZipCodec(), archive = await zip.readZipArchive(bytes, zipLimits, context.signal);
  const parts = new Map<string, Uint8Array>();
  for (const entry of archive.entries) {
    const chunks = [];
    for await (const chunk of zip.decodeZipEntry(entry, zipLimits, context.signal)) chunks.push(chunk);
    parts.set(entry.name, new Uint8Array(Buffer.concat(chunks)));
  }
  return { archive, parts };
}

it.each(["strict", "extended"] as const)("authenticates the complete %s package and preserves exact inner members", async profile => {
  const b = bindings(), writer = createOdfWriter(profile), original = structuredClone(book), observed: unknown[] = [];
  vi.mocked(argon2idAsync).mockImplementation(async (start, salt, options) => {
    observed.push({ start: new Uint8Array(start as Uint8Array), salt: new Uint8Array(salt as Uint8Array), options });
    return new Uint8Array(32).fill(0x47);
  });
  const plain = await unpack(await writer(book, [], context));
  const encrypted = await unpack(await writer(book, options, { ...b.context, outputFilename: "/private.ods" }));
  expect([...encrypted.parts.keys()].sort()).toEqual(["META-INF/manifest.xml", "encrypted-package", "mimetype"]);
  const manifest = parseXml(new TextDecoder().decode(encrypted.parts.get("META-INF/manifest.xml")));
  expect(manifest.children).toHaveLength(1);
  const attr = (node: typeof manifest, name: string) => node.attributes.find(a => a.localName === name)!.value;
  const member = manifest.children[0]!, encryption = member.children[0]!;
  expect(attr(member, "full-path")).toBe("encrypted-package");
  expect(attr(member, "media-type")).toBe("application/vnd.oasis.opendocument.spreadsheet");
  expect(encryption.attributes).toHaveLength(0);
  const algorithm = encryption.children.find(c => c.localName === "algorithm")!, kdf = encryption.children.find(c => c.localName === "key-derivation")!;
  expect(attr(algorithm, "algorithm-name")).toBe("http://www.w3.org/2009/xmlenc11#aes256-gcm");
  expect(attr(kdf, "key-derivation-name")).toBe("urn:org:documentfoundation:names:experimental:office:manifest:argon2id");
  expect(["argon2-iterations", "argon2-memory", "argon2-lanes"].map(name => attr(kdf, name))).toEqual(["3", "65536", "4"]);
  expect(kdf.attributes.filter(a => a.localName.startsWith("argon2-")).every(a =>
    a.namespace === "urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0")).toBe(true);
  const iv = Buffer.from(attr(algorithm, "initialisation-vector"), "base64"), framed = encrypted.parts.get("encrypted-package")!;
  expect(framed.subarray(0, 12)).toEqual(new Uint8Array(iv));
  expect(encrypted.archive.entries.find(entry => entry.name === "encrypted-package")!.method).toBe(0);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.alloc(32, 0x47), iv).setAuthTag(framed.subarray(-16));
  const inner = inflateRawSync(Buffer.concat([decipher.update(framed.subarray(12, -16)), decipher.final()]));
  expect(inner.length).toBe(Number(attr(member, "size")));
  expect((await unpack(inner)).parts).toEqual(plain.parts);
  expect(observed).toEqual([{ start: new Uint8Array(createHash("sha256").update(b.secret).digest()), salt: b.borrowed.subarray(0, 16),
    options: expect.objectContaining({ t: 3, m: 65536, p: 4, dkLen: 32, version: 0x13, maxmem: 64 * 1024 * 1024 }) }]);
  expect(b.password).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ purpose: "encrypt", algorithm: "aes-gcm",
    revision: "libreoffice", encoding: "utf8", outputFilename: "/private.ods" }));
  expect(b.entropy).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ length: 28 }));
  expect(b.secret).toEqual(new TextEncoder().encode("海\0🌊")); expect(b.borrowed).toEqual(Uint8Array.from({ length: 28 }, (_, i) => i));
  expect(book).toEqual(original);
});

it.each([{ encryptionMemoryBytes: 64 * 1024 * 1024 - 1 }, { workbookWork: 10000000 }, { zipEntries: 9 }])(
  "admits cumulative package and KDF limits before secrets: %j", async reduced => {
    const b = bindings();
    await expect(createOdfWriter("extended")(book, options, { ...b.context, limits: { ...context.limits, ...reduced } }))
      .rejects.toMatchObject({ code: "resource-limit" });
    expect(b.password).not.toHaveBeenCalled(); expect(b.entropy).not.toHaveBeenCalled(); expect(argon2idAsync).not.toHaveBeenCalled();
  });

it.each(["password", "entropy"] as const)("requires explicit %s authority", async missing => {
  const b = bindings();
  await expect(createOdfWriter("extended")(book, options, { ...b.context, [missing]: undefined }))
    .rejects.toMatchObject({ code: "unsupported-feature" });
  expect(b.password).not.toHaveBeenCalled(); expect(b.entropy).not.toHaveBeenCalled();
});

it.each([undefined, new Uint8Array(27), new Uint8Array(29)])("refuses incorrectly sized entropy %j", async bytes => {
  const b = bindings();
  await expect(createOdfWriter("extended")(book, options, { ...b.context, entropy: { async read() { return bytes; } } }))
    .rejects.toMatchObject({ code: "unsupported-feature" });
  expect(argon2idAsync).not.toHaveBeenCalled();
});

it("preserves the destination and drains the admitted KDF on cancellation", async () => {
  const b = bindings(), controller = new AbortController(), volume = Volume.fromJSON({ "/output.ods": "retained" });
  const write = vi.fn(async (path: string, bytes: Uint8Array) => { volume.writeFileSync(path, bytes); });
  const key = new Uint8Array(32).fill(0x47);
  let finish!: (key: Uint8Array<ArrayBuffer>) => void, started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  vi.mocked(argon2idAsync).mockImplementation(() => new Promise(resolve => { finish = resolve; started(); }));
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    password: b.context.password, entropy: b.context.entropy, filesystem: { async read() { return []; }, write } });
  try {
    const pending = engine.convert({ input: { kind: "stream", filename: "input.csv", source: [new TextEncoder().encode("42\n")] },
      destination: { kind: "resource", uri: "/output.ods" }, exportType: "Gnumeric_OpenCalc:odf", exportOptions: options },
      { signal: controller.signal });
    let settled = false; void pending.then(() => { settled = true; }, () => { settled = true; });
    await admitted; controller.abort(false);
    try { await new Promise(resolve => setTimeout(resolve, 0)); expect(settled).toBe(false); }
    finally { finish(key); }
    await expect(pending).rejects.toBe(false);
    expect(key.every(byte => byte === 0)).toBe(true); expect(write).not.toHaveBeenCalled();
    expect(volume.readFileSync("/output.ods", "utf8")).toBe("retained");
  } finally { await engine.dispose(); }
});

it.each(["openoffice", "odf"])("exposes the %s profile through CLI and SDK", async exporter => {
  const b = bindings(), chunks: Uint8Array[] = [], engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    password: b.context.password, entropy: b.context.entropy,
    filesystem: { async read() { return [new TextEncoder().encode("42\n")]; }, async write() { throw new Error("unexpected write"); } } });
  try {
    const result = await runCommand(["/input.csv", "fd://1", "-T", `Gnumeric_OpenCalc:${exporter}`, "-O", options[0]!], engine,
      { ...context, stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write() {} } });
    expect(result.exitCode).toBe(0);
    expect((await readOdf(Buffer.concat(chunks), b.context)).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
  } finally { await engine.dispose(); }
});
