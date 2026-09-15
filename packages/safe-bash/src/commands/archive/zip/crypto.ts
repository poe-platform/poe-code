import { readBytes, type ByteSource } from "../../../contracts/index.js";
import { yieldTurn } from "../../../contracts/yield.js";
import { crcTable } from "./crc.js";

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
