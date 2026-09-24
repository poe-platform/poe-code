import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  aesCbcDecrypt,
  aesCbcEncrypt,
  md5Bytes,
  sha256Bytes,
  sha384Bytes,
  sha512Bytes,
} from "./crypto-primitives.js";

describe("crypto-primitives parity with node:crypto", () => {
  it("matches MD5, SHA-256, SHA-384, and SHA-512 across empty, short, and multi-block payloads", () => {
    const payloads = [
      new Uint8Array(0),
      new TextEncoder().encode("abc"),
      new TextEncoder().encode("The quick brown fox jumps over the lazy dog"),
      new Uint8Array(256).map((_, i) => (i * 37) & 0xff),
    ];

    for (const p of payloads) {
      expect(md5Bytes([p])).toEqual(new Uint8Array(createHash("md5").update(p).digest()));
      expect(sha256Bytes([p])).toEqual(new Uint8Array(createHash("sha256").update(p).digest()));
      expect(sha384Bytes(p)).toEqual(new Uint8Array(createHash("sha384").update(p).digest()));
      expect(sha512Bytes(p)).toEqual(new Uint8Array(createHash("sha512").update(p).digest()));
    }
  });

  it("matches AES-128-CBC and AES-256-CBC with and without PKCS#7 padding", () => {
    const key128 = new Uint8Array(16).map((_, i) => i + 1);
    const key256 = new Uint8Array(32).map((_, i) => (i * 3 + 7) & 0xff);
    const iv = new Uint8Array(16).map((_, i) => (i * 11) & 0xff);
    const msg = new TextEncoder().encode("Hello PDF 2.0 AES-256-CBC Encryption Engine!");

    const c256 = createCipheriv("aes-256-cbc", key256, iv);
    const expected256 = new Uint8Array(Buffer.concat([c256.update(msg), c256.final()]));
    const actual256 = aesCbcEncrypt(key256, iv, msg, true);
    expect(actual256).toEqual(expected256);
    expect(aesCbcDecrypt(key256, iv, actual256, true)).toEqual(msg);

    const block32 = new Uint8Array(32).map((_, i) => (i * 13) & 0xff);
    const c128NoPad = createCipheriv("aes-128-cbc", key128, iv);
    c128NoPad.setAutoPadding(false);
    const expected128NoPad = new Uint8Array(Buffer.concat([c128NoPad.update(block32), c128NoPad.final()]));
    const actual128NoPad = aesCbcEncrypt(key128, iv, block32, false);
    expect(actual128NoPad).toEqual(expected128NoPad);
    const d128NoPad = createDecipheriv("aes-128-cbc", key128, iv);
    d128NoPad.setAutoPadding(false);
    expect(aesCbcDecrypt(key128, iv, actual128NoPad, false)).toEqual(
      new Uint8Array(Buffer.concat([d128NoPad.update(expected128NoPad), d128NoPad.final()]))
    );
  });
});
