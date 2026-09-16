import { readBytes, type ByteSource } from "../../../contracts/index.js";
import { yieldTurn } from "../../../contracts/yield.js";
import { crcTable } from "./crc.js";
import { fail, type ZipHost } from "../internal.js";
import { PublicDiagnostic } from "../../../diagnostics.js";

/** Fixed capability diagnostics may be shown without credential-text filtering. */
export class ZipHostFailure extends PublicDiagnostic {
  constructor(readonly code: "no-echo" | "entropy" | "entropy-failed" | "entropy-bytes" | "prompt-failed" | "prompt-eof" | "password-bytes" | "password-empty" | "password-confirm") {
    super({
      "no-echo": "ZIP no-echo password capability is unavailable",
      entropy: "ZIP entropy capability is unavailable",
      "entropy-failed": "ZIP entropy capability failed",
      "entropy-bytes": "ZIP entropy capability must return 11 bytes",
      "prompt-failed": "ZIP password capability failed",
      "prompt-eof": "ZIP EOF while reading password",
      "password-bytes": "ZIP invalid password bytes",
      "password-empty": "zero length password not allowed",
      "password-confirm": "password verification failed",
    }[code]);
  }
}

export interface ZipEncryption {
  readonly password: Uint8Array;
  readonly entropy: NonNullable<ZipHost["entropy"]>;
}

export async function* encryptZipPayload(source: ByteSource, encryption: ZipEncryption, verifier: number, signal: AbortSignal): ByteSource {
  signal.throwIfAborted();
  const password = new Uint8Array(encryption.password);
  let random: Uint8Array;
  try { random = await encryption.entropy(11, signal); }
  catch (error) {
    signal.throwIfAborted();
    throw new ZipHostFailure(error instanceof ZipHostFailure && error.code === "entropy" ? "entropy" : "entropy-failed");
  }
  signal.throwIfAborted();
  if (!(random instanceof Uint8Array) || random.length !== 11) throw new ZipHostFailure("entropy-bytes");
  const header = new Uint8Array(12);
  header.set(random);
  header[11] = verifier;
  yield* zipCrypto((async function* () { yield header; yield* readBytes(source, signal); })(), password, false, signal);
}

export async function* decryptZipPayload(source: ByteSource, password: Uint8Array, verifier: number, signal: AbortSignal): ByteSource {
  let header = 0;
  for await (const chunk of zipCrypto(source, new Uint8Array(password), true, signal)) {
    let offset = 0;
    while (header < 12 && offset < chunk.length) {
      if (header === 11 && chunk[offset] !== verifier) fail("ZIP incorrect password");
      header++; offset++;
    }
    if (offset < chunk.length) yield chunk.subarray(offset);
  }
  if (header !== 12) fail("ZIP truncated encryption header");
}

export async function readZipPassword(host: ZipHost | undefined, maxBytes: number, signal: AbortSignal, confirm: boolean): Promise<Uint8Array> {
  if (!host?.password) throw new ZipHostFailure("no-echo");
  const read = async (prompt: string): Promise<Uint8Array> => {
    signal.throwIfAborted();
    let bytes: Uint8Array | undefined;
    try { bytes = await host.password!({ prompt, maxBytes, signal }); }
    catch { signal.throwIfAborted(); throw new ZipHostFailure("prompt-failed"); }
    signal.throwIfAborted();
    if (!bytes) throw new ZipHostFailure("prompt-eof");
    if (!(bytes instanceof Uint8Array) || bytes.length > maxBytes || bytes.includes(0)) throw new ZipHostFailure("password-bytes");
    return new Uint8Array(bytes);
  };
  const password = await read("Enter password: ");
  if (confirm) {
    if (!password.length) throw new ZipHostFailure("password-empty");
    const repeated = await read("Verify password: ");
    if (password.length !== repeated.length || password.some((byte, index) => byte !== repeated[index])) throw new ZipHostFailure("password-confirm");
  }
  return password;
}

/** Traditional PKZIP byte transformation; callers own header/password checks. */
export async function* zipCrypto(source: ByteSource, password: Uint8Array, decode: boolean, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  signal.throwIfAborted();
  let key0 = 0x12345678, key1 = 0x23456789, key2 = 0x34567890;
  const update = (byte: number): void => {
    key0 = (key0 >>> 8 ^ crcTable[(key0 ^ byte) & 255]!) >>> 0;
    key1 = (Math.imul(key1 + (key0 & 255), 134775813) + 1) >>> 0;
    key2 = (key2 >>> 8 ^ crcTable[(key2 ^ key1 >>> 24) & 255]!) >>> 0;
  };
  for (let index = 0; index < password.length; index++) {
    update(password[index]!);
    if ((index + 1) % 65536 === 0) await yieldTurn(signal);
  }
  for await (const bytes of readBytes(source, signal)) {
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      signal.throwIfAborted();
      const output = new Uint8Array(Math.min(65536, bytes.length - offset));
      for (let index = 0; index < output.length; index++) {
        const value = bytes[offset + index]!;
        const temporary = (key2 & 65535) | 2;
        const transformed = value ^ (Math.imul(temporary, temporary ^ 1) >>> 8 & 255);
        update(decode ? transformed : value);
        output[index] = transformed;
      }
      yield output;
      await yieldTurn(signal);
    }
  }
}
