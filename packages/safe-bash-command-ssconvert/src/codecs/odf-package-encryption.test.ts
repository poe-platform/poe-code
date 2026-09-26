import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { gcm } from "@noble/ciphers/aes.js";
import { argon2id } from "@noble/hashes/argon2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { createZipCodec } from "@poe-code/office-package";
import { parseXml } from "@poe-code/safe-fs/xml";
import { packageVectors, innerPackageBytes } from "./odf-package-encryption-fixtures.js";
import { readOdf } from "./odf.js";
import { decryptOdfEntries } from "./odf-encryption.js";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 100 } };
const limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
const namespace = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";
function declaration(vector = packageVectors[0] as typeof packageVectors[number]): string {
  return `<m:manifest xmlns:m="${namespace}" xmlns:x="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0" m:version="1.4"><m:file-entry m:full-path="encrypted-package" m:media-type="application/vnd.oasis.opendocument.spreadsheet" m:size="${innerPackageBytes}"><m:encryption-data><m:algorithm m:algorithm-name="http://www.w3.org/2009/xmlenc11#aes256-gcm" m:initialisation-vector="EBESExQVFhcYGRob"/><m:start-key-generation m:start-key-generation-name="http://www.w3.org/2001/04/xmlenc#sha256" m:key-size="32"/><m:key-derivation m:key-derivation-name="urn:org:documentfoundation:names:experimental:office:manifest:argon2id" x:argon2-iterations="${vector.iterations}" x:argon2-memory="${vector.memoryKiB}" x:argon2-lanes="${vector.lanes}" m:salt="AAECAwQFBgcICQoLDA0ODw==" m:key-size="32"/></m:encryption-data></m:file-entry></m:manifest>`;
}
async function fixture(manifest = declaration(), ciphertext: string = packageVectors[0].ciphertextHex,
  extra: readonly (readonly [string, Uint8Array])[] = []): Promise<Uint8Array> {
  const zip = createZipCodec(), entries = [];
  for (const [name, bytes] of [["mimetype", new TextEncoder().encode("application/vnd.oasis.opendocument.spreadsheet")],
    ["META-INF/manifest.xml", new TextEncoder().encode(manifest)],
    ["encrypted-package", Uint8Array.from(Buffer.from(ciphertext, "hex"))], ...extra] as const)
    entries.push(await zip.makeZipEntry(name, bytes, { modified: new Date("2000-01-01Z"), mode: 0o644,
      directory: false, symlink: false, compression: "store" }, limits, context.signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}

it.each(packageVectors)("imports independently authenticated Argon2id/GCM package with $lanes lanes", async vector => {
  const input = await fixture(declaration(vector), vector.ciphertextHex), original = input.slice();
  const secret = new TextEncoder().encode(vector.password), before = secret.slice();
  const read = vi.fn(async request => {
    expect(Object.isFrozen(request)).toBe(true);
    expect(request).toMatchObject({ format: "odf", algorithm: "aes-gcm", revision: "libreoffice", encoding: "utf8" });
    return secret;
  });
  const book = await readOdf(input, { ...context, password: { read } });
  expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([{ kind: "string", value: "private" }, { kind: "number", value: 42 }]);
  expect(read).toHaveBeenCalledTimes(1); expect(secret).toEqual(before); expect(input).toEqual(original);
});

it.each(["password", "tag", "ciphertext"])("authenticates the entire package before parsing on %s failure", async mode => {
  const bytes = Buffer.from(packageVectors[0].ciphertextHex, "hex");
  if (mode !== "password") { const at = mode === "tag" ? bytes.length - 1 : 20; bytes[at] = bytes[at]! ^ 1; }
  const read = vi.fn(async () => mode === "password" ? "wrong" : packageVectors[0].password);
  await expect(readOdf(await fixture(declaration(), bytes.toString("hex")), { ...context, password: { read } }))
    .rejects.toMatchObject({ code: "io", message: "E Invalid OpenDocument: encrypted content could not be verified" });
  expect(read).toHaveBeenCalledTimes(1);
});

it.each([
  ["work", declaration().replace('argon2-iterations="2"', 'argon2-iterations="1000000"'), "resource-limit"],
  ["memory", declaration().replace('argon2-memory="32"', 'argon2-memory="1000000"'), "resource-limit"],
  ["size", declaration().replace(`m:size="${innerPackageBytes}"`, 'm:size="1000000"'), "resource-limit"],
  ["zero lanes", declaration().replace('argon2-lanes="1"', 'argon2-lanes="0"'), "io"],
  ["unsupported KDF", declaration().replace('manifest:argon2id', 'manifest:argon2i'), "unsupported-feature"],
  ["foreign parameters", declaration().replace('xmlns:loext:1.0', 'xmlns:foreign:1.0'), "io"]
])("admits %s before requesting a password", async (_name, manifest, code) => {
  const read = vi.fn(async () => packageVectors[0].password);
  await expect(readOdf(await fixture(manifest), { ...context, password: { read } })).rejects.toMatchObject({ code });
  expect(read).not.toHaveBeenCalled();
});

it("refuses a plaintext shadow of the encrypted container before password acquisition", async () => {
  const read = vi.fn(async () => packageVectors[0].password);
  await expect(readOdf(await fixture(declaration(), packageVectors[0].ciphertextHex, [["content.xml", new TextEncoder().encode("shadow")]]),
    { ...context, password: { read } })).rejects.toMatchObject({ code: "io" });
  expect(read).not.toHaveBeenCalled();
});

it.each(["mimetype", "encrypted-package", "META-INF/manifest.xml"])("rejects authenticated inner %s confusion", async name => {
  const zip = createZipCodec(), vector = packageVectors[0], encode = (text: string) => new TextEncoder().encode(text);
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index);
  const key = argon2id(sha256(encode(vector.password)), salt, { t: vector.iterations, m: vector.memoryKiB, p: vector.lanes, dkLen: 32 });
  const original = Buffer.from(vector.ciphertextHex, "hex"), iv = original.subarray(0, 12);
  const inner = inflateRawSync(gcm(key, iv).decrypt(original.subarray(12)));
  const archive = await zip.readZipArchive(inner, limits, context.signal);
  const content = name === "mimetype" ? "application/vnd.oasis.opendocument.text" : name === "encrypted-package" ? "nested"
    : `<m:manifest xmlns:m="${namespace}"><m:file-entry m:full-path="content.xml"><m:encryption-data/></m:file-entry></m:manifest>`;
  const entry = await zip.makeZipEntry(name, encode(content), { modified: new Date("2000-01-01Z"), mode: 0o644,
    directory: false, symlink: false, compression: "store" }, limits, context.signal);
  const changed = await zip.writeZipArchive({ entries: [...archive.entries.filter(member => member.name !== name), entry],
    comment: new Uint8Array() }, limits, context.signal);
  const encrypted = Buffer.concat([iv, gcm(key, iv).encrypt(deflateRawSync(changed))]);
  const read = vi.fn(async () => vector.password);
  await expect(readOdf(await fixture(declaration().replace(`m:size="${innerPackageBytes}"`, `m:size="${changed.length}"`), encrypted.toString("hex")),
    { ...context, password: { read } })).rejects.toMatchObject({ code: "io", message: name === "encrypted-package"
    ? "E Invalid OpenDocument: nested encrypted package" : name === "mimetype"
      ? "E Invalid OpenDocument: inconsistent encrypted package media type" : "E Invalid OpenDocument: invalid inner package manifest" });
  expect(read).toHaveBeenCalledTimes(1);
});

it.each([
  ["arena", { encryptionMemoryBytes: 32767 }],
  ["aggregate members", { zipEntries: 4 }],
  ["aggregate expansion", { inflatedBytes: 2000 }],
  ["aggregate work", { workbookWork: 66000 }]
])("preserves existing destinations on %s refusal", async (_name, reduced) => {
  const input = await fixture(), volume = Volume.fromJSON({ "/output.csv": "retained" });
  const write = vi.fn(async (path: string, bytes: Uint8Array) => { volume.writeFileSync(path, bytes); });
  const engine = createEngine({ codecs: [], environment: context.environment, limits: { ...context.limits, ...reduced },
    password: { async read() { return packageVectors[0].password; } }, filesystem: { async read() { return [input]; }, write } });
  try {
    await expect(engine.convert({ input: { kind: "stream", filename: "encrypted.ods", source: [input] },
      destination: { kind: "resource", uri: "/output.csv" }, exportType: "Gnumeric_stf:stf_csv" }, context))
      .rejects.toMatchObject({ code: "resource-limit" });
    expect(write).not.toHaveBeenCalled(); expect(volume.readFileSync("/output.csv", "utf8")).toBe("retained");
  } finally { await engine.dispose(); }
});

it("converts the authenticated inner workbook through the CLI engine", async () => {
  const input = await fixture(), stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits,
    password: { async read() { return packageVectors[0].password; } }, filesystem: {
      async read() { return [input]; }, async write() { throw new Error("Unexpected filesystem publication"); }
    } });
  try {
    const result = await runCommand(["/encrypted.ods", "fd://1", "-T", "Gnumeric_stf:stf_csv"], engine,
      { ...context, stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
    expect(result.exitCode).toBe(0);
    expect(Buffer.concat(stdout).toString()).toBe("private,42\n"); expect(stderr).toHaveLength(0);
  } finally { await engine.dispose(); }
});

it("registers and wipes authenticated package plaintext without changing the host password", async () => {
  const zip = createZipCodec(), input = await fixture();
  const archive = await zip.readZipArchive(input, limits, context.signal);
  const entries = new Map(archive.entries.map(entry => [entry.name, entry]));
  const cleanups: (() => unknown)[] = [], password = new TextEncoder().encode(packageVectors[0].password), original = password.slice();
  const result = await decryptOdfEntries(parseXml(declaration()), entries, async name => entries.get(name)!.data,
    { ...context, own(cleanup) { cleanups.push(cleanup); }, password: { async read() { expect(cleanups).toHaveLength(1); return password; } } },
    () => {}, 100000, 100000);
  const plaintext = result.get("encrypted-package")!;
  expect(plaintext.length).toBe(innerPackageBytes); expect([...plaintext.subarray(0, 2)]).toEqual([80, 75]);
  for (const cleanup of cleanups) await cleanup();
  expect(plaintext.every(byte => byte === 0)).toBe(true); expect(password).toEqual(original);
});

it("drains and cleans the admitted Argon2 operation before propagating cancellation", async () => {
  const controller = new AbortController(), reason = new Error("cancelled by caller");
  const manifest = declaration().replace('argon2-memory="32"', 'argon2-memory="8192"');
  const input = await fixture(manifest), password = new TextEncoder().encode(packageVectors[0].password), original = password.slice();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = readOdf(input, { ...context, limits: { ...context.limits, workbookWork: 20000000 }, signal: controller.signal, password: { async read() {
    timer = setTimeout(() => controller.abort(reason), 0); return password;
  } } });
  try { await expect(pending).rejects.toBe(reason); }
  finally { clearTimeout(timer); }
  expect(password).toEqual(original);
});

it.each([-1, NaN, -Infinity, 0.5])("rejects invalid encryption memory limit %s", encryptionMemoryBytes => {
  expect(() => createEngine({ codecs: [], environment: context.environment,
    limits: { ...context.limits, encryptionMemoryBytes } })).toThrow("Invalid ssconvert limit: encryptionMemoryBytes");
});
