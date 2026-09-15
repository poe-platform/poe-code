import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { generateSshKey, transformSshKey } from "./ssh.js";

const rsaFixture = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC4wzvAXRhMYkIs
LeAlzMpXwgvVlwbDhWg/j1SwPp9bvINuGsjA0OBaqrOnTSZ1IbFcJv9S8vNyc+gz
mgRQT07oXD5o0KZoGtM/mJTrKklgXmE/Agx/r62waz3c0lZoH8+FSrYpS2t+6IPa
LoD+4djg7hiqsC/F7glN/06+70aqyx5DblPmDD8006ewlQYgm+gC/rTxfi+vDo4A
kcDeTfXXP7yxIFLO6bgLsYk57wwE3jsK0PnPsf5rTg8o231pdvLfHMhRNcGhbKi1
+RtF6ToFDRkc9Mr+nLzo6MnRarHdDOeHhXC022IBeJirgZUxkJBvcECE3ZQoQbyQ
BpyJoyydAgMBAAECggEAMihyLqk3QPlFzJeRq8FaRxO7QbtTzz2GzQZ8r7H4ch+N
sJTd3hZ2abbAudDkeVTxwLong13IQFB9/5A2zpSRL9xm5u6J1mY95hxmhScAL4S/
sqq8OOe459VdQHbrlS3ZmO5s4G4EmznFHbSVOVyXk4yfrqrQ9VNHPGDsgEIV9aRj
NP/xcEb3+LQO7MxkbU104jKaxjN9O5Rr9U4qdE/4LmWR5/OJ3DMTboNCOah22Q5J
uPKtToYXrgPfRNjJ9xeA+2fpzDp1m7uNdTXc9V2q8CUTZIFs7PWcPUCFOuhJMyj7
MX4u6SccIi0LjI5xtqlO9uD/qAJbuQ+tuuPREjDHowKBgQDrzqNlpEq3kbzpXijH
WGeRBmUhopAVAGNYp0sMm+GM8UdVcg0/luessIS2k1EqiloFo90+m0INJQWKHbik
5P34XKt9JpD7Z7deipFPHOzykuoifRRF2kbWAV2Jqvk/580nhHh/FewYkxqRfrIy
yfKJiE7M0SwyRrdbZwuIPrfIwwKBgQDIlZjjEtIcBSJjsDoGVrw9fpxlY5MJsfnb
h623uj2q40EgqyZ5WQRb7Oy1r+xxrTTg7cNYTpy0EeDQmoceEzmovva4CcEO25hk
4s06xXwE8W1/T4ZeEg+nDG0XeyLNFWmsmC+fWPYTA/HIymAykT55x/Uplam+5jCH
9XBoKIDfHwKBgHCwLGfLbqVxMR05ETXKqpukubmsLTzMFa3tLLFW4R/wwg00Vt53
qDlfldyGZDh3K3QcjgN4QMV1VsNdVrr+b9w7tPw27Pwn4Xp9r9ll0lpOGTPoIEMN
f+KPfnrmyPxgMytaZBcfi9dmnUDAkjoxRgWxrS62G2/fWYqFoP44Mq3vAoGAF9bX
xd0dxaDClpCCRPCYDML4eYBdIGDbrkCw384tuBqsSeKtfuyafQZql6lh85y/VSBN
ADjPnQMm8gP7nRJx3uFbV0IphMeKlCr0c1C3TasX9XKRKKsC2zq52HmVCETMO2wW
9NxQ2q+0U8XhqwDiKP0f4SJde0fGatI72tU9g8cCgYEAuqFkJ/mNDzYYtV/8on/G
LqoWwLY4TN3A1IaUG3o/wNJaq4X+prw9PcXu9toA3A3x+84kM7pYgoCJk3c1OMBk
2CSHSYHlb9zn8LR2DWxoFu4ganUjl+N2g8tihvmEOXRYgeNJlQaY/u8Yk7m29UOL
I2IGAUU8W/Jnhwu0vejyVAo=
-----END PRIVATE KEY-----
`;

test("Ed25519 generation returns SSH fields, verifiable keys, and SHA256 fingerprint", async () => {
  const item = await generateSshKey();
  assert.equal(item.category, "SSH_KEY");
  const fields = Object.fromEntries(item.fields.map(field => [field.id, field]));
  assert.equal(fields.private_key.type, "SSHKEY");
  assert.equal(fields.key_type.value, "ed25519");
  assert.ok(fields.private_key.value.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----\n"));
  const privateKey = crypto.createPrivateKey(transformSshKey(fields.private_key.value, "pkcs8"));
  const publicJwk = crypto.createPublicKey(privateKey).export({ format: "jwk" });
  const [algorithm, encoded] = fields.public_key.value.split(" ");
  assert.equal(algorithm, "ssh-ed25519");
  const wire = Buffer.from(encoded, "base64");
  assert.equal(wire.readUInt32BE(0), 11);
  assert.equal(wire.subarray(4, 15).toString(), algorithm);
  assert.equal(wire.readUInt32BE(15), 32);
  assert.equal(wire.subarray(19).toString("base64url"), publicJwk.x);
  assert.equal(fields.fingerprint.value, `SHA256:${crypto.createHash("sha256").update(wire).digest("base64").split("=")[0]}`);
  const message = Buffer.from("ssh roundtrip");
  assert.ok(crypto.verify(null, message, crypto.createPublicKey(privateKey), crypto.sign(null, message, privateKey)));
  assert.notEqual((await generateSshKey("Ed25519")).fields[0].value, fields.private_key.value);
});

test("RSA generation selects each supported size without slow key generation", async (context) => {
  const privateKey = crypto.createPrivateKey(rsaFixture);
  const publicKey = crypto.createPublicKey(privateKey);
  const calls: unknown[][] = [];
  context.mock.method(crypto, "generateKeyPair", (...args: unknown[]) => {
    calls.push(args.slice(0, 2));
    (args.at(-1) as (error: null, publicKey: crypto.KeyObject, privateKey: crypto.KeyObject) => void)(null, publicKey, privateKey);
  });
  for (const [type, bits] of [["rsa", 4096], ["rsa2048", 2048], ["rsa3072", 3072], ["rsa4096", 4096], ["RSA", 4096]] as const) {
    const result = await generateSshKey(type);
    assert.deepEqual(calls.at(-1), ["rsa", { modulusLength: bits, publicExponent: 65537 }]);
    const fields = Object.fromEntries(result.fields.map(field => [field.id, field.value]));
    assert.ok(fields.public_key.startsWith("ssh-rsa "));
    assert.deepEqual(crypto.createPrivateKey(transformSshKey(fields.private_key, "pkcs1")).export({ format: "jwk" }), privateKey.export({ format: "jwk" }));
  }
});

test("RSA transforms preserve key material across PKCS1, PKCS8, and OpenSSH", () => {
  const expected = crypto.createPrivateKey(rsaFixture).export({ format: "jwk" });
  for (const source of [rsaFixture, transformSshKey(rsaFixture, "pkcs1"), transformSshKey(rsaFixture, "openssh")]) {
    for (const format of ["pkcs1", "pkcs8"] as const) {
      const converted = transformSshKey(source, format);
      assert.deepEqual(crypto.createPrivateKey(converted).export({ format: "jwk" }), expected);
    }
    const reopened = transformSshKey(transformSshKey(source, "openssh"), "pkcs8");
    assert.deepEqual(crypto.createPrivateKey(reopened).export({ format: "jwk" }), expected);
  }
});

test("Ed25519 PKCS8 inputs roundtrip through OpenSSH and reject RSA-only PKCS1", () => {
  const privateKey = crypto.createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" }, format: "jwk" });
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const openssh = transformSshKey(pkcs8, "openssh");
  assert.deepEqual(crypto.createPrivateKey(transformSshKey(openssh, "pkcs8")).export({ format: "jwk" }), privateKey.export({ format: "jwk" }));
  assert.throws(() => transformSshKey(openssh, "pkcs1"), { message: "PKCS1 requires an RSA private key" });
});

test("invalid selectors, unsupported keys, and crypto failures do not leak key material", async (context) => {
  for (const type of ["", "rsa1024", "rsa8192", "ecdsa", "rsa2048-secret"]) await assert.rejects(generateSshKey(type), { message: "Unsupported SSH key type" });
  assert.throws(() => transformSshKey("secret text", "openssh"), { message: "Invalid or unsupported SSH private key" });
  assert.throws(() => transformSshKey(rsaFixture, "invalid" as "pkcs8"), { message: "Unsupported SSH private key format" });
  const unsupported = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.throws(() => transformSshKey(unsupported, "openssh"), { message: "Invalid or unsupported SSH private key" });
  context.mock.method(crypto, "generateKeyPair", (...args: unknown[]) => {
    (args.at(-1) as (error: Error) => void)(new Error("sensitive provider failure"));
  });
  await assert.rejects(generateSshKey(), { message: "SSH key generation failed" });
  context.mock.method(crypto, "generateKeyPair", () => { throw new Error("sensitive synchronous failure"); });
  await assert.rejects(generateSshKey(), { message: "SSH key generation failed" });
});

test("OpenSSH decoding rejects corrupt framing, checkints, public keys, and padding", () => {
  const source = transformSshKey(rsaFixture, "openssh");
  const original = Buffer.from(source.split("\n").slice(1, -2).join(""), "base64");
  const encode = (bytes: Buffer) => `-----BEGIN OPENSSH PRIVATE KEY-----\n${bytes.toString("base64")}\n-----END OPENSSH PRIVATE KEY-----\n`;
  let offset = 15;
  for (let field = 0; field < 3; field++) offset += 4 + original.readUInt32BE(offset);
  const countOffset = offset;
  offset += 4;
  const publicOffset = offset + 4;
  offset += 4 + original.readUInt32BE(offset);
  const privateOffset = offset + 4;
  for (const corrupt of [0, 19, countOffset + 3, publicOffset + 15, privateOffset + 4, original.length - 1]) {
    const bytes = Buffer.from(original);
    bytes[corrupt] ^= 0xff;
    assert.throws(() => transformSshKey(encode(bytes), "pkcs8"), { message: "Invalid or unsupported SSH private key" });
  }
  for (const bytes of [original.subarray(0, 12), original.subarray(0, -1), Buffer.concat([original, Buffer.from([0])])]) {
    assert.throws(() => transformSshKey(encode(bytes), "pkcs8"), { message: "Invalid or unsupported SSH private key" });
  }
  assert.throws(() => transformSshKey(source.split("\n").join("!"), "pkcs8"));
});
