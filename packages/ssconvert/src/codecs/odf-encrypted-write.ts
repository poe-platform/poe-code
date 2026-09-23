import { cbc } from "@noble/ciphers/aes.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { createCompressionCodec } from "@poe-code/office-package";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { deriveOdfKey } from "./odf-encryption.js";
import { odfNamespaces, type createOdfXml } from "./odf-write-support.js";

// Explicit legacy ODF 1.2 interoperability profile, matching its 1024-round KDF.
const iterations = 1024;
function unsupported(message: string): never {
  throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: encrypted OpenDocument ${message}`);
}
function limit(): never {
  throw new SsconvertError("resource-limit", "ssconvert OpenDocument encrypted output bytes limit exceeded");
}
function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/** All parts are invocation-owned. Return ciphertext plus manifest declarations;
 * nothing reaches the destination before the complete package is admitted. */
export async function encryptOdfParts(parts: ReadonlyMap<string, Uint8Array>, context: CapabilityContext,
  xml: ReturnType<typeof createOdfXml>): Promise<Map<string, { bytes: Uint8Array; size: number; declaration: string }>> {
  if (!context.password || !context.entropy) unsupported("export requires password and cryptographic entropy capabilities");
  const members = [...parts].filter(([name]) => name !== "mimetype" && name !== "META-INF/manifest.xml");
  let plaintextBytes = 0;
  for (const [, bytes] of members) {
    plaintextBytes += bytes.length;
    if (plaintextBytes > context.limits.outputBytes) limit();
    // Admit all PBKDF2 rounds, input compression work and AES block work together.
    xml.charge(iterations * 2 * 128 + bytes.length * 8 + 128);
  }
  const maxBytes = Math.min(4096, context.limits.inputBytes);
  let secret: string | Uint8Array | undefined;
  context.signal.throwIfAborted();
  try {
    secret = await context.password.read(Object.freeze({ purpose: "encrypt", format: "odf", algorithm: "aes-cbc",
      revision: "1.2", encoding: "utf8", maxBytes, signal: context.signal,
      ...(context.outputFilename === undefined ? {} : { outputFilename: context.outputFilename }) }));
  } catch { context.signal.throwIfAborted(); unsupported("password acquisition failed"); }
  context.signal.throwIfAborted();
  if (secret === undefined) unsupported("password required");
  if (typeof secret === "string" ? secret.length > maxBytes || [...secret].some(c => {
    const code = c.codePointAt(0)!; return code >= 0xd800 && code <= 0xdfff;
  }) : !(secret instanceof Uint8Array) || secret.length > maxBytes) unsupported("password encoding or length");
  const password = typeof secret === "string" ? new TextEncoder().encode(secret) : new Uint8Array(secret);
  const result = new Map<string, { bytes: Uint8Array; size: number; declaration: string }>();
  let start: Uint8Array | undefined, total = 0;
  try {
    if (password.length > maxBytes) unsupported("password encoding or length");
    try { new TextDecoder("utf-8", { fatal: true }).decode(password); } catch { unsupported("password encoding or length"); }
    start = sha256(password);
    for (const [name, bytes] of members) {
      const codec = createCompressionCodec(), input = new codec.CodecReader((async function* () { yield bytes; })(), context.signal);
      const chunks: Uint8Array[] = []; let size = 0;
      let entropy: Uint8Array | undefined, key: Uint8Array | undefined, padded: Uint8Array | undefined;
      try {
        for await (const chunk of codec.codec(input, { mode: "deflate-raw", chunkSize: 16384 }, context.signal)) {
          context.signal.throwIfAborted();
          if (chunk.length > context.limits.outputBytes - total - size) limit();
          xml.charge(chunk.length); chunks.push(new Uint8Array(chunk)); size += chunk.length;
        }
        const padding = 16 - size % 16;
        if (size + padding > context.limits.outputBytes - total) limit();
        let borrowed: Uint8Array | undefined;
        context.signal.throwIfAborted();
        try { borrowed = await context.entropy.read(Object.freeze({ length: 48, signal: context.signal })); }
        catch { context.signal.throwIfAborted(); unsupported("entropy acquisition failed"); }
        context.signal.throwIfAborted();
        if (!(borrowed instanceof Uint8Array) || borrowed.length !== 48) unsupported("entropy must provide exactly 48 bytes");
        entropy = new Uint8Array(borrowed);
        const salt = entropy.subarray(0, 16), iv = entropy.subarray(16, 32);
        padded = new Uint8Array(size + padding); let offset = 0;
        for (const chunk of chunks) { padded.set(chunk, offset); offset += chunk.length; chunk.fill(0); }
        const checksum = sha256(padded.subarray(0, Math.min(size, 1024)));
        // XML Encryption CBC: random padding followed by its one-byte length.
        padded.set(entropy.subarray(32, 32 + padding), size); padded[padded.length - 1] = padding;
        key = await deriveOdfKey(start, salt, iterations, 32, context);
        const ciphertext = new Uint8Array(padded.length); let previous = iv;
        for (let at = 0; at < padded.length; at += 16384) {
          context.signal.throwIfAborted();
          const encrypted = cbc(key, previous, { disablePadding: true }).encrypt(padded.subarray(at, at + 16384));
          ciphertext.set(encrypted, at); previous = ciphertext.subarray(at + encrypted.length - 16, at + encrypted.length);
          if (at) await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        context.signal.throwIfAborted(); total += ciphertext.length;
        const e = xml.element;
        const declaration = e("manifest:encryption-data", { "manifest:checksum-type": odfNamespaces.manifest + "#sha256-1k", "manifest:checksum": base64(checksum) },
          e("manifest:algorithm", { "manifest:algorithm-name": "http://www.w3.org/2001/04/xmlenc#aes256-cbc", "manifest:initialisation-vector": base64(iv) }) +
          e("manifest:key-derivation", { "manifest:key-derivation-name": "PBKDF2", "manifest:iteration-count": iterations, "manifest:key-size": 32, "manifest:salt": base64(salt) }) +
          e("manifest:start-key-generation", { "manifest:start-key-generation-name": "http://www.w3.org/2000/09/xmldsig#sha256", "manifest:key-size": 32 }));
        result.set(name, { bytes: ciphertext, size: bytes.length, declaration });
      } finally {
        key?.fill(0); entropy?.fill(0); padded?.fill(0); for (const chunk of chunks) chunk.fill(0);
        await input.close();
      }
    }
    return result;
  } finally { password.fill(0); start?.fill(0); }
}
