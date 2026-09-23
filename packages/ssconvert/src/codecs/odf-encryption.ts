import { decryptOdfBlowfish } from "./odf-blowfish.js";
import { cbc } from "@noble/ciphers/aes.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { createCompressionCodec, type ZipEntry } from "@poe-code/office-package";
import type { XmlElement } from "@poe-code/safe-fs/xml";
import { SsconvertError, type CapabilityContext } from "../contracts.js";

const manifestNamespace = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";
const hashAlgorithms = new Map([
  ["SHA1", sha1], ["http://www.w3.org/2000/09/xmldsig#sha1", sha1],
  ["http://www.w3.org/2000/09/xmldsig#sha256", sha256], ["http://www.w3.org/2001/04/xmlenc#sha256", sha256]
]);
const aesAlgorithms = new Map([
  ["http://www.w3.org/2001/04/xmlenc#aes128-cbc", 16],
  ["http://www.w3.org/2001/04/xmlenc#aes192-cbc", 24],
  ["http://www.w3.org/2001/04/xmlenc#aes256-cbc", 32]
]);
function invalid(message: string): never {
  throw new SsconvertError("io", `E Invalid OpenDocument: ${message}`);
}
function unsupported(message = "package"): never {
  throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: encrypted OpenDocument ${message}`);
}
function attribute(node: XmlElement | undefined, name: string): string | undefined {
  return node?.attributes.find(a => a.namespace === manifestNamespace && a.localName === name)?.value;
}
function child(node: XmlElement, name: string, optional = false): XmlElement | undefined {
  const found = node.children.filter(c => c.namespace === manifestNamespace && c.localName === name);
  if (found.length > 1 || !optional && found.length !== 1) invalid("invalid encryption declaration");
  return found[0];
}
function integer(value: string | undefined): number {
  const source = value?.trim(), digits = source?.startsWith("+") ? source.slice(1) : source;
  if (!digits || [...digits].some(c => c < "0" || c > "9")) invalid("invalid encryption integer");
  const number = Number(digits);
  if (!Number.isSafeInteger(number))
    throw new SsconvertError("resource-limit", "ssconvert OpenDocument encryption integer limit exceeded");
  return number;
}
function binary(value: string | undefined, size?: number): Uint8Array {
  if (value === undefined) invalid("missing encryption bytes");
  const compact = [...value].filter(c => !" \t\r\n".includes(c)).join("");
  let decoded: string;
  try { decoded = atob(compact); if (btoa(decoded) !== compact) invalid("invalid encryption bytes"); }
  catch { invalid("invalid encryption bytes"); }
  if (size !== undefined && decoded.length !== size) invalid("invalid encryption byte length");
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
/** RFC2898 PBKDF2-HMAC-SHA1, using the vetted HMAC implementation with
 * per-round cancellation and bounded scheduler yields. Work is admitted first. */
export async function deriveOdfKey(start: Uint8Array, salt: Uint8Array, iterations: number, size: number, context: CapabilityContext): Promise<Uint8Array> {
  const key = new Uint8Array(size), input = new Uint8Array(salt.length + 4), counter = new DataView(input.buffer);
  input.set(salt);
  const prf = hmac.create(sha1, start);
  let u: Uint8Array | undefined;
  try {
    for (let block = 1, position = 0; position < size; block++, position += 20) {
      counter.setUint32(salt.length, block);
      u = prf.clone().update(input).digest();
      const result = key.subarray(position, Math.min(position + 20, size)); result.set(u.subarray(0, result.length));
      for (let round = 1; round < iterations; round++) {
        context.signal.throwIfAborted();
        const next = prf.clone().update(u).digest(); u.fill(0); u = next;
        for (let i = 0; i < result.length; i++) result[i] = result[i]! ^ u[i]!;
        if ((round & 255) === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      u.fill(0); u = undefined;
    }
    context.signal.throwIfAborted(); return key;
  } catch (error) { key.fill(0); throw error; }
  finally { prf.destroy(); u?.fill(0); input.fill(0); }
}

/** Admit every encrypted member before acquiring one package password. The
 * checksum checks password correctness; legacy ODF encryption does not authenticate. */
export async function decryptOdfEntries(manifest: XmlElement, entries: ReadonlyMap<string, ZipEntry>,
  read: (name: string) => Promise<Uint8Array>, context: CapabilityContext, charge: (amount?: number) => void,
  remainingBytes: number, maximumEntryBytes: number): Promise<Map<string, Uint8Array>> {
  if (!context.password) unsupported();
  if (manifest.namespace !== manifestNamespace) unsupported("manifest revision");
  const profiles = [], paths = new Set<string>(); let total = 0;
  for (const entry of manifest.children) {
    charge();
    if (entry.namespace !== manifestNamespace || entry.localName !== "file-entry") continue;
    const path = attribute(entry, "full-path");
    if (!path || paths.has(path)) invalid("ambiguous manifest member");
    paths.add(path);
  }
  for (const entry of manifest.children) {
    charge();
    const declarations = entry.children.filter(c => c.localName === "encryption-data");
    if (!declarations.length) continue;
    if (declarations.length !== 1 || entry.namespace !== manifestNamespace || entry.localName !== "file-entry" || declarations[0]!.namespace !== manifestNamespace)
      invalid("invalid encryption declaration");
    const path = attribute(entry, "full-path");
    if (!path || path === "mimetype" || path === "META-INF/manifest.xml" || !entries.has(path)) invalid("invalid encrypted member");
    const member = entries.get(path)!, encryption = declarations[0]!, algorithm = child(encryption, "algorithm")!, derivation = child(encryption, "key-derivation")!;
    const algorithmName = attribute(algorithm, "algorithm-name") ?? "";
    const blowfish = algorithmName === "Blowfish CFB" || algorithmName === manifestNamespace + "#blowfish";
    const cipher: "aes-cbc" | "blowfish-cfb8" = blowfish ? "blowfish-cfb8" : "aes-cbc";
    const keyBytes = blowfish ? integer(attribute(derivation, "key-size") ?? "16") : aesAlgorithms.get(algorithmName);
    if (keyBytes === undefined) unsupported("encryption algorithm");
    if (blowfish && (keyBytes < 4 || keyBytes > 56)) unsupported("encryption key size");
    if (member.method !== 0 || member.size === 0 || !blowfish && member.size % 16) invalid("invalid encrypted member framing");
    if (attribute(derivation, "key-derivation-name") !== "PBKDF2") unsupported("key derivation");
    if (integer(attribute(derivation, "key-size") ?? "16") !== keyBytes) invalid("inconsistent encryption key size");
    const iterations = integer(attribute(derivation, "iteration-count"));
    if (!iterations) invalid("invalid encryption iteration count");
    const size = integer(attribute(entry, "size"));
    if (size > maximumEntryBytes || size > (context.limits.zipRatio ?? 1000) * member.size)
      throw new SsconvertError("resource-limit", "ssconvert OpenDocument decrypted entry limit exceeded");
    total += size + member.size;
    if (!Number.isSafeInteger(total) || total > remainingBytes)
      throw new SsconvertError("resource-limit", "ssconvert OpenDocument decrypted bytes limit exceeded");
    const startGeneration = child(encryption, "start-key-generation", true);
    const startHash = hashAlgorithms.get(attribute(startGeneration, "start-key-generation-name") ?? "SHA1");
    if (!startHash) unsupported("start key algorithm");
    if (integer(attribute(startGeneration, "key-size") ?? "20") !== startHash.outputLen) invalid("inconsistent start key size");
    const checksumType = attribute(encryption, "checksum-type") ?? "SHA1/1K";
    const checksumHash = checksumType === "SHA1/1K" || checksumType === manifestNamespace + "#sha1-1k" ? sha1
      : checksumType === manifestNamespace + "#sha256-1k" ? sha256 : hashAlgorithms.get(checksumType);
    if (!checksumHash) unsupported("checksum algorithm");
    const checksum = binary(attribute(encryption, "checksum"), checksumHash.outputLen), iv = binary(attribute(algorithm, "initialisation-vector"), blowfish ? 8 : 16), salt = binary(attribute(derivation, "salt"));
    if (!salt.length) invalid("empty encryption salt");
    // Bound all PRF rounds, cipher blocks/setup, inflated bytes and salt copying together.
    charge(iterations * Math.ceil(keyBytes / 20) * 128 + (blowfish ? (member.size + 521) * 128 : member.size * 4) + size + salt.length * Math.ceil(keyBytes / 20));
    profiles.push({ path, cipher, keyBytes, iterations, size, startHash, checksumHash, checksum, iv, salt,
      prefixChecksum: checksumType === "SHA1/1K" || checksumType === manifestNamespace + "#sha1-1k" || checksumType === manifestNamespace + "#sha256-1k" });
  }
  const result = new Map<string, Uint8Array>();
  if (!profiles.length) return result;
  const firstCipher = profiles[0]!.cipher;
  const packageCipher = profiles.every(profile => profile.cipher === firstCipher) ? firstCipher : "mixed";
  const maxBytes = Math.min(4096, context.limits.inputBytes);
  context.signal.throwIfAborted();
  let secret: string | Uint8Array | undefined;
  try {
    secret = await context.password.read(Object.freeze({ format: "odf", algorithm: packageCipher, revision: "1.2", encoding: "utf8", maxBytes,
      signal: context.signal, ...(context.inputFilename === undefined ? {} : { inputFilename: context.inputFilename }) }));
  } catch { context.signal.throwIfAborted(); unsupported("password acquisition failed"); }
  context.signal.throwIfAborted();
  if (secret === undefined) unsupported("password required");
  if (typeof secret === "string" ? secret.length > maxBytes : !(secret instanceof Uint8Array) || secret.length > maxBytes)
    unsupported("password encoding or length");
  if (typeof secret === "string" && [...secret].some(character => {
    const point = character.codePointAt(0)!;
    return point >= 0xd800 && point <= 0xdfff;
  })) unsupported("password encoding or length");
  const password = typeof secret === "string" ? new TextEncoder().encode(secret) : new Uint8Array(secret);
  try {
    if (password.length > maxBytes) unsupported("password encoding or length");
    // Byte inputs are explicit UTF8, including NUL, without normalization.
    try { new TextDecoder("UTF-8", { fatal: true }).decode(password); } catch { unsupported("password encoding or length"); }
    for (const profile of profiles) {
      const start = profile.startHash(password); let key: Uint8Array | undefined, compressed: Uint8Array | undefined;
      try {
        key = await deriveOdfKey(start, profile.salt, profile.iterations, profile.keyBytes, context);
        const ciphertext = await read(profile.path);
        let padding = 0;
        if (profile.cipher === "blowfish-cfb8") compressed = await decryptOdfBlowfish(key, profile.iv, ciphertext, context.signal);
        else {
          compressed = new Uint8Array(ciphertext.length); let iv = profile.iv;
          for (let at = 0; at < ciphertext.length; at += 16384) {
            context.signal.throwIfAborted();
            const chunk = ciphertext.subarray(at, Math.min(at + 16384, ciphertext.length));
            const block = cbc(key, iv, { disablePadding: true }).decrypt(chunk);
            try { compressed.set(block, at); } finally { block.fill(0); }
            iv = chunk.subarray(chunk.length - 16);
            if (at) await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
          // XML Encryption CBC permits arbitrary preceding pad bytes.
          padding = compressed[compressed.length - 1]!;
          if (padding < 1 || padding > 16) invalid("encrypted content could not be verified");
        }
        const payload = compressed.subarray(0, compressed.length - padding), digest = profile.checksumHash(profile.prefixChecksum ? payload.subarray(0, 1024) : payload);
        let mismatch = 0; for (let i = 0; i < digest.length; i++) mismatch |= digest[i]! ^ profile.checksum[i]!;
        if (mismatch) invalid("encrypted content could not be verified");
        const codec = createCompressionCodec(), input = new codec.CodecReader((async function* () { yield payload; })(), context.signal), plaintext = new Uint8Array(profile.size);
        let length = 0;
        try {
          for await (const chunk of codec.codec(input, { mode: "inflate-raw", chunkSize: 16384 }, context.signal)) {
            if (chunk.length > plaintext.length - length) invalid("encrypted content could not be verified");
            plaintext.set(chunk, length); length += chunk.length;
          }
          if (length !== plaintext.length || await input.chunk() !== undefined) invalid("encrypted content could not be verified");
        } catch (error) {
          plaintext.fill(0); context.signal.throwIfAborted();
          if (error instanceof SsconvertError) throw error;
          invalid("encrypted content could not be verified");
        } finally { await input.close(); compressed.fill(0); }
        result.set(profile.path, plaintext);
      } finally { start.fill(0); key?.fill(0); compressed?.fill(0); }
    }
    context.own(() => { for (const bytes of result.values()) bytes.fill(0); });
    return result;
  } catch (error) { for (const bytes of result.values()) bytes.fill(0); throw error; }
  finally { password.fill(0); }
}
