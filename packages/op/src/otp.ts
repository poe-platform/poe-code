import { opCrypto } from "#op-crypto";

function decodeBase32(value: string): Uint8Array<ArrayBuffer> {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let pending = 0;
  let count = 0;
  let padding = false;
  for (const character of value.toUpperCase()) {
    if (character === " " || character === "\t" || character === "\n" || character === "\r") continue;
    if (character === "=") { padding = true; continue; }
    const digit = alphabet.indexOf(character);
    if (digit < 0 || padding) throw new Error("Invalid OTP secret encoding");
    pending = (pending << 5) | digit;
    count += 5;
    if (count >= 8) {
      count -= 8;
      bytes.push((pending >>> count) & 255);
      pending &= (1 << count) - 1;
    }
  }
  if (bytes.length === 0 || pending !== 0) throw new Error("Invalid OTP secret encoding");
  return Uint8Array.from(bytes);
}

export async function generateOtp(value: string, now = Date.now()): Promise<string> {
  let secret = value;
  let digits = 6;
  let period = 30;
  let algorithm = "SHA1";
  if (value.startsWith("otpauth://")) {
    let uri: URL;
    try { uri = new URL(value); } catch { throw new Error("Invalid OTP configuration"); }
    if (uri.hostname !== "totp" || uri.username || uri.password || uri.port) throw new Error("Invalid OTP configuration");
    secret = uri.searchParams.get("secret") ?? "";
    digits = Number(uri.searchParams.get("digits") ?? "6");
    period = Number(uri.searchParams.get("period") ?? "30");
    algorithm = (uri.searchParams.get("algorithm") ?? "SHA1").toUpperCase();
  }
  if (![6, 8].includes(digits) || !Number.isSafeInteger(period) || period < 1 || !Number.isSafeInteger(now) || now < 0) {
    throw new Error("Invalid OTP configuration");
  }
  const hashes: Record<string, string> = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };
  if (!Object.hasOwn(hashes, algorithm)) throw new Error("Invalid OTP algorithm");
  const rawKey = decodeBase32(secret);
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(now / 1000 / period)));
  try {
    const key = await opCrypto.subtle.importKey("raw", rawKey, { name: "HMAC", hash: hashes[algorithm] }, false, ["sign"]);
    const digest = new Uint8Array(await opCrypto.subtle.sign("HMAC", key, counter));
    const offset = digest[digest.length - 1] & 15;
    const binary = new DataView(digest.buffer).getUint32(offset) & 0x7fffffff;
    return String(binary % 10 ** digits).padStart(digits, "0");
  } finally {
    rawKey.fill(0);
  }
}
