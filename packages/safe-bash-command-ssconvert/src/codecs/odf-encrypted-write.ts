import { cbc, gcm } from "@noble/ciphers/aes.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { createCompressionCodec } from "@poe-code/office-package";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { deriveOdfKey } from "./odf-encryption.js";
import { transformOdfBlowfish } from "./odf-blowfish.js";
import { odfNamespaces, type createOdfXml } from "./odf-write-support.js";

// Explicit legacy ODF 1.2 interoperability profile, matching its 1024-round KDF.
const iterations = 1024;
const argon2 = { t: 3, m: 65536, p: 4, dkLen: 32, version: 0x13, maxmem: 64 * 1024 * 1024, asyncTick: 10 };
export interface OdfEncryptionProfile {
  readonly cipher: "aes-cbc" | "aes-gcm" | "blowfish-cfb8" | "blowfish-cfb64";
  readonly keyBytes: number;
}
export const odfEncryptionProfiles: ReadonlyMap<string, OdfEncryptionProfile> = new Map([
  ["odf12-aes128-cbc", { cipher: "aes-cbc", keyBytes: 16 }],
  ["odf12-aes192-cbc", { cipher: "aes-cbc", keyBytes: 24 }],
  ["odf12-aes256-cbc", { cipher: "aes-cbc", keyBytes: 32 }],
  ["odf12-blowfish-cfb8", { cipher: "blowfish-cfb8", keyBytes: 16 }],
  ["odf12-blowfish-cfb64", { cipher: "blowfish-cfb64", keyBytes: 16 }],
  ["libreoffice-aes256-gcm", { cipher: "aes-gcm", keyBytes: 32 }]
]);
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
  xml: ReturnType<typeof createOdfXml>, profile: OdfEncryptionProfile): Promise<Map<string, { bytes: Uint8Array; size: number; declaration: string }>> {
  if (!context.password || !context.entropy) unsupported("export requires password and cryptographic entropy capabilities");
  const authenticated = profile.cipher === "aes-gcm";
  const blowfish = profile.cipher === "blowfish-cfb8" || profile.cipher === "blowfish-cfb64", hash = blowfish ? sha1 : sha256;
  if (authenticated && (context.limits.encryptionMemoryBytes ?? argon2.maxmem) < argon2.maxmem)
    throw new SsconvertError("resource-limit", "ssconvert OpenDocument encryption memory limit exceeded");
  const feedbackBytes = profile.cipher === "blowfish-cfb64" ? 8 : 1;
  const members = [...parts].filter(([name]) => name !== "mimetype" && name !== "META-INF/manifest.xml");
  let plaintextBytes = 0;
  for (const [, bytes] of members) {
    plaintextBytes += bytes.length;
    if (plaintextBytes > context.limits.outputBytes) limit();
    // Admit key derivation, input compression and cipher work together.
    xml.charge((authenticated ? argon2.m * argon2.t * 1024 : iterations * Math.ceil(profile.keyBytes / 20) * 128) + bytes.length * 8 + 128);
  }
  const maxBytes = context.limits.inputBytes;
  let secret: string | Uint8Array | undefined;
  context.signal.throwIfAborted();
  try {
    secret = await context.password.read(Object.freeze({ purpose: "encrypt", format: "odf", algorithm: profile.cipher,
      revision: authenticated ? "libreoffice" : "1.2", encoding: "utf8", maxBytes, signal: context.signal,
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
    start = hash(password);
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
        const padding = blowfish || authenticated ? 0 : 16 - size % 16;
        if (size + padding + (authenticated ? 28 : 0) > context.limits.outputBytes - total) limit();
        // Each feedback segment encrypts a full block, plus the key schedule.
        if (blowfish) xml.charge((Math.ceil(size / feedbackBytes) + 521) * 128);
        const entropyBytes = authenticated ? 28 : blowfish ? 24 : 48;
        let borrowed: Uint8Array | undefined;
        context.signal.throwIfAborted();
        try { borrowed = await context.entropy.read(Object.freeze({ length: entropyBytes, signal: context.signal })); }
        catch { context.signal.throwIfAborted(); unsupported("entropy acquisition failed"); }
        context.signal.throwIfAborted();
        if (!(borrowed instanceof Uint8Array) || borrowed.length !== entropyBytes) unsupported(`entropy must provide exactly ${entropyBytes} bytes`);
        entropy = new Uint8Array(borrowed);
        const salt = entropy.subarray(0, 16), iv = entropy.subarray(16, authenticated ? 28 : blowfish ? 24 : 32);
        padded = new Uint8Array(size + padding); let offset = 0;
        for (const chunk of chunks) { padded.set(chunk, offset); offset += chunk.length; chunk.fill(0); }
        const checksum = hash(padded.subarray(0, Math.min(size, 1024)));
        // XML Encryption CBC: random padding followed by its one-byte length.
        if (padding) { padded.set(entropy.subarray(32, 32 + padding), size); padded[padded.length - 1] = padding; }
        // As with import, drain Argon2 so its arena is cleared before cancellation.
        key = authenticated ? await argon2idAsync(start, salt, argon2) : await deriveOdfKey(start, salt, iterations, profile.keyBytes, context);
        context.signal.throwIfAborted();
        const ciphertext = blowfish ? await transformOdfBlowfish(key, iv, padded, context.signal, "encrypt", feedbackBytes)
          : new Uint8Array(padded.length + (authenticated ? 28 : 0));
        if (authenticated) { ciphertext.set(iv); ciphertext.set(gcm(key, iv).encrypt(padded), 12); }
        let previous = iv;
        for (let at = 0; profile.cipher === "aes-cbc" && at < padded.length; at += 16384) {
          context.signal.throwIfAborted();
          const encrypted = cbc(key, previous, { disablePadding: true }).encrypt(padded.subarray(at, at + 16384));
          ciphertext.set(encrypted, at); previous = ciphertext.subarray(at + encrypted.length - 16, at + encrypted.length);
          if (at) await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        context.signal.throwIfAborted(); total += ciphertext.length;
        const e = xml.element;
        const declaration = e("manifest:encryption-data", authenticated ? {} : { "manifest:checksum-type": blowfish ? "SHA1/1K" : odfNamespaces.manifest + "#sha256-1k", "manifest:checksum": base64(checksum) },
          e("manifest:algorithm", { "manifest:algorithm-name": authenticated ? "http://www.w3.org/2009/xmlenc11#aes256-gcm"
            : blowfish ? "Blowfish CFB" : `http://www.w3.org/2001/04/xmlenc#aes${profile.keyBytes * 8}-cbc`, "manifest:initialisation-vector": base64(iv) }) +
          e("manifest:key-derivation", { ...(authenticated ? { "manifest:key-derivation-name": "urn:org:documentfoundation:names:experimental:office:manifest:argon2id",
            "loext:argon2-iterations": argon2.t, "loext:argon2-memory": argon2.m, "loext:argon2-lanes": argon2.p }
            : { "manifest:key-derivation-name": "PBKDF2", "manifest:iteration-count": iterations }), "manifest:key-size": profile.keyBytes, "manifest:salt": base64(salt) }) +
          e("manifest:start-key-generation", { "manifest:start-key-generation-name": authenticated ? "http://www.w3.org/2001/04/xmlenc#sha256"
            : "http://www.w3.org/2000/09/xmldsig#" + (blowfish ? "sha1" : "sha256"), "manifest:key-size": hash.outputLen }));
        result.set(name, { bytes: ciphertext, size: bytes.length, declaration });
      } finally {
        key?.fill(0); entropy?.fill(0); padded?.fill(0); for (const chunk of chunks) chunk.fill(0);
        await input.close();
      }
    }
    return result;
  } finally { password.fill(0); start?.fill(0); }
}
