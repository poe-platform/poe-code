import assert from "node:assert/strict";
import { test } from "node:test";
import { generateOtp } from "./otp.js";

test("matches RFC 6238 SHA-1 vectors", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const vectors = [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]] as const;
  for (const [seconds, expected] of vectors) {
    assert.equal(await generateOtp(`otpauth://totp/Example?secret=${secret}&digits=8`, seconds * 1000), expected);
  }
  assert.equal(await generateOtp(secret, 59000), "287082");
});

test("supports SHA-256 and SHA-512 with explicit period", async () => {
  const sha256 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
  const sha512 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA";
  assert.equal(await generateOtp(`otpauth://totp/Example?secret=${sha256}&algorithm=SHA256&digits=8`, 59000), "46119246");
  assert.equal(await generateOtp(`otpauth://totp/Example?secret=${sha512}&algorithm=SHA512&digits=8`, 59000), "90693936");
  assert.equal(await generateOtp(`otpauth://totp/Example?secret=${sha256}&algorithm=SHA256&digits=8&period=60`, 119000), "46119246");
});

test("rejects malformed OTP settings without including the input", async () => {
  for (const value of ["private!", "otpauth://hotp/Example?secret=AAAA", "otpauth://totp/Example", "otpauth://totp/Example?secret=AAAA&digits=100", "otpauth://totp/Example?secret=AAAA&period=0", "otpauth://totp/Example?secret=AAAA&algorithm=MD5"]) {
    await assert.rejects(generateOtp(value), error => error instanceof Error && !error.message.includes(value));
  }
  await assert.rejects(generateOtp("AAAA", -1));
});
