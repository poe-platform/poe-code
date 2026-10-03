import { CodecReader } from "safe-bash-compression-engine/codec";
import { ecb } from "@noble/ciphers/aes.js";
import { equalBytes } from "@noble/ciphers/utils.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { collectBytes,readBytes,type ByteSource } from "safe-bash-contracts";
import { yieldTurn } from "safe-bash-contracts/yield";
import { fail } from "safe-bash-io-engine/commands/archive/internal";
import type { ZipEncryption } from "./crypto.js";

/** WinZip AES encryption specification 1.04, AE-1 and AE-2. */
export interface ZipAes { readonly strength: 128 | 192 | 256; readonly version: 1 | 2 }

export function zipEncryptionProfile(profile: string): ZipAes | undefined {
  if (profile === "zipcrypto") return undefined;
  const [prefix, strength, version, extra] = profile.split("-");
  if (prefix !== "aes" || extra !== undefined || !["128", "192", "256"].includes(strength!) || !["ae1", "ae2"].includes(version!)) fail("ZIP unsupported encryption profile");
  return { strength: Number(strength) as ZipAes["strength"], version: version === "ae1" ? 1 : 2 };
}

export function aesParameters(aes: ZipAes): { keyBytes: number; saltBytes: number } {
  if (aes.version !== 1 && aes.version !== 2) fail("ZIP unsupported AES version");
  if (aes.strength !== 128 && aes.strength !== 192 && aes.strength !== 256) fail("ZIP unsupported AES strength");
  return { keyBytes: aes.strength / 8, saltBytes: aes.strength / 16 };
}

function keys(password: Uint8Array, salt: Uint8Array, aes: ZipAes, signal: AbortSignal): Uint8Array {
  signal.throwIfAborted();
  const { keyBytes } = aesParameters(aes);
  // The fixed 1000-iteration derivation creates no asynchronous resource to
  // outlive invocation cleanup. Check cancellation before and after derivation.
  const derived = pbkdf2(sha1, password, salt, { c: 1000, dkLen: keyBytes * 2 + 2 });
  if (signal.aborted) { derived.fill(0); signal.throwIfAborted(); }
  return derived;
}

async function transform(input: Uint8Array, key: Uint8Array, signal: AbortSignal): Promise<Uint8Array> {
  const output = new Uint8Array(input.length);
  try {
    // The extension uses AES(counter), with a 128-bit little-endian counter
    // starting at one. OpenSSL CTR's big-endian increment is incompatible.
    for (let offset = 0; offset < input.length; offset += 65536) {
      signal.throwIfAborted();
      const length = Math.min(65536, input.length - offset);
      const counters = new Uint8Array(Math.ceil(length / 16) * 16);
      const view = new DataView(counters.buffer);
      for (let block = 0; block < counters.length; block += 16) view.setBigUint64(block, BigInt((offset + block) / 16 + 1), true);
      const stream = ecb(key, { disablePadding: true }).encrypt(counters);
      for (let i = 0; i < length; i++) output[offset + i] = input[offset + i]! ^ stream[i]!;
      stream.fill(0);
      await yieldTurn(signal);
    }
    return output;
  } catch (error) { output.fill(0); throw error; }
}

export async function encryptAesPayload(source: ByteSource, encryption: ZipEncryption & { aes: ZipAes }, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const { keyBytes, saltBytes } = aesParameters(encryption.aes);
  const aes = { ...encryption.aes };
  const password = new Uint8Array(encryption.password);
  let plaintext: Uint8Array | undefined;
  let derived: Uint8Array | undefined;
  try {
    plaintext = await collectBytes(source, { ...(Number.isFinite(maxBytes) ? { maxBytes } : {}), signal });
    let supplied: Uint8Array;
    try { supplied = await encryption.entropy(saltBytes, signal); }
    catch { signal.throwIfAborted(); fail("ZIP AES entropy capability failed"); }
    signal.throwIfAborted();
    if (!(supplied instanceof Uint8Array) || supplied.length !== saltBytes) fail("ZIP invalid AES entropy bytes");
    const salt = new Uint8Array(supplied);
    derived = keys(password, salt, aes, signal);
    const encrypted = await transform(plaintext, derived.subarray(0, keyBytes), signal);
    const tag = hmac(sha1, derived.subarray(keyBytes, keyBytes * 2), encrypted);
    const wire = new Uint8Array(saltBytes + 2 + encrypted.length + 10);
    wire.set(salt);
    wire.set(derived.subarray(keyBytes * 2), saltBytes);
    wire.set(encrypted, saltBytes + 2);
    wire.set(tag.subarray(0, 10), wire.length - 10);
    encrypted.fill(0);
    tag.fill(0);
    return wire;
  } finally { plaintext?.fill(0); derived?.fill(0); password.fill(0); }
}

export async function decryptAesPayload(wire: Uint8Array, password: Uint8Array, aes: ZipAes, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const { keyBytes, saltBytes } = aesParameters(aes);
  aes = { ...aes };
  if (maxBytes !== Infinity && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) throw new RangeError("maxBytes must be a nonnegative safe integer");
  if (wire.length < saltBytes + 12) fail("ZIP truncated AES payload");
  const size = wire.length - saltBytes - 12;
  if (size > maxBytes) fail("ZIP AES authenticated staging limit exceeded");
  // Copy before asynchronous KDF work; callers cannot mutate authenticated bytes.
  const owned = new Uint8Array(wire);
  const secret = new Uint8Array(password);
  let derived: Uint8Array | undefined;
  try {
    derived = keys(secret, owned.subarray(0, saltBytes), aes, signal);
    if (!equalBytes(derived.subarray(keyBytes * 2), owned.subarray(saltBytes, saltBytes + 2))) fail("ZIP incorrect password");
    const encrypted = owned.subarray(saltBytes + 2, owned.length - 10);
    const tag = hmac(sha1, derived.subarray(keyBytes, keyBytes * 2), encrypted);
    const authentic = equalBytes(tag.subarray(0, 10), owned.subarray(owned.length - 10));
    tag.fill(0);
    if (!authentic) fail("ZIP AES authentication failed");
    return await transform(encrypted, derived.subarray(0, keyBytes), signal);
  } finally { derived?.fill(0); secret.fill(0); owned.fill(0); }
}

export function aesExtra(aes: ZipAes, method: number): Uint8Array {
  aesParameters(aes);
  const bytes = new Uint8Array(11);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x9901, true);
  view.setUint16(2, 7, true);
  view.setUint16(4, aes.version, true);
  bytes.set([65, 69, aes.strength / 64 - 1], 6);
  view.setUint16(9, method, true);
  return bytes;
}

function transformChunk(input: Uint8Array, key: Uint8Array, position: number): Uint8Array {
  const skip = position % 16;
  const counters = new Uint8Array(Math.ceil((skip + input.length) / 16) * 16);
  const view = new DataView(counters.buffer);
  for (let block = 0; block < counters.length; block += 16) view.setBigUint64(block, BigInt(Math.floor(position / 16) + block / 16 + 1), true);
  const stream = ecb(key, { disablePadding: true }).encrypt(counters);
  const result = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) result[i] = input[i]! ^ stream[skip + i]!;
  stream.fill(0);
  return result;
}

export async function* encryptAesStream(source: ByteSource, encryption: ZipEncryption & { aes: ZipAes }, maxBytes: number, signal: AbortSignal): ByteSource {
  signal.throwIfAborted();
  const aes = { ...encryption.aes };
  const { keyBytes, saltBytes } = aesParameters(aes);
  const password = new Uint8Array(encryption.password);
  let derived: Uint8Array | undefined;
  let mac: ReturnType<typeof hmac.create> | undefined;
  try {
    let supplied: Uint8Array;
    try { supplied = await encryption.entropy(saltBytes, signal); }
    catch { signal.throwIfAborted(); fail("ZIP AES entropy capability failed"); }
    signal.throwIfAborted();
    if (!(supplied instanceof Uint8Array) || supplied.length !== saltBytes) fail("ZIP invalid AES entropy bytes");
    const header = new Uint8Array(saltBytes + 2);
    header.set(supplied);
    derived = keys(password, header.subarray(0, saltBytes), aes, signal);
    header.set(derived.subarray(keyBytes * 2), saltBytes);
    mac = hmac.create(sha1, derived.subarray(keyBytes, keyBytes * 2));
    yield header;
    await yieldTurn(signal);
    let position = 0;
    for await (const chunk of readBytes(source, signal)) {
      if (chunk.length > maxBytes - position) fail("ZIP AES input byte limit exceeded");
      for (let offset = 0; offset < chunk.length; offset += 65536) {
        signal.throwIfAborted();
        const encrypted = transformChunk(chunk.subarray(offset, offset + 65536), derived.subarray(0, keyBytes), position);
        position += encrypted.length;
        mac.update(encrypted);
        yield encrypted;
        await yieldTurn(signal);
      }
    }
    const tag = mac.digest();
    yield tag.slice(0, 10);
    tag.fill(0);
  } finally { mac?.destroy(); derived?.fill(0); password.fill(0); }
}

/** Untrusted plaintext for an owned staging sink ONLY; authentication completes
 * at EOF. A consumer must discard all output unless iteration succeeds. */
export async function* decryptAesToStaging(source: ByteSource, wireSize: number, password: Uint8Array, aes: ZipAes, signal: AbortSignal): ByteSource {
  const { keyBytes, saltBytes } = aesParameters(aes);
  if (wireSize < saltBytes + 12) fail("ZIP truncated AES payload");
  const reader = new CodecReader(source, signal);
  const exact = async (size: number) => {
    const result = new Uint8Array(size);
    let used = 0;
    while (used < size) {
      const chunk = await reader.chunk();
      if (!chunk) fail("ZIP truncated AES payload");
      const take = Math.min(size - used, chunk.length);
      result.set(chunk.subarray(0, take), used); used += take;
      if (take < chunk.length) reader.restore(chunk.subarray(take));
    }
    return result;
  };
  const secret = new Uint8Array(password);
  let derived: Uint8Array | undefined;
  let mac: ReturnType<typeof hmac.create> | undefined;
  try {
    const header = await exact(saltBytes + 2);
    derived = keys(secret, header.subarray(0, saltBytes), aes, signal);
    if (!equalBytes(derived.subarray(keyBytes * 2), header.subarray(saltBytes))) fail("ZIP incorrect password");
    mac = hmac.create(sha1, derived.subarray(keyBytes, keyBytes * 2));
    const size = wireSize - saltBytes - 12;
    for (let position = 0; position < size;) {
      const ciphertext = await exact(Math.min(65536, size - position));
      mac.update(ciphertext);
      const plaintext = transformChunk(ciphertext, derived.subarray(0, keyBytes), position);
      position += plaintext.length;
      yield plaintext;
      await yieldTurn(signal);
    }
    const supplied = await exact(10);
    const tag = mac.digest();
    const authentic = equalBytes(tag.subarray(0, 10), supplied);
    tag.fill(0);
    if (!authentic) fail("ZIP AES authentication failed");
    if (await reader.chunk()) fail("ZIP trailing AES payload");
  } finally { await reader.close(); mac?.destroy(); derived?.fill(0); secret.fill(0); }
}
