import crypto from "node:crypto";

export type SshPrivateKeyFormat = "openssh" | "pkcs1" | "pkcs8";

export interface GeneratedSshKey {
  category: "SSH_KEY";
  fields: { id: string; label: string; type: "SSHKEY" | "STRING"; value: string }[];
}

const opensshMagic = Buffer.from("openssh-key-v1\0");

function uint32(value: number): Buffer {
  const encoded = Buffer.alloc(4);
  encoded.writeUInt32BE(value);
  return encoded;
}

function sshString(value: string | Buffer): Buffer {
  const bytes = typeof value === "string" ? Buffer.from(value) : value;
  return Buffer.concat([uint32(bytes.length), bytes]);
}

function mpint(value: string): Buffer {
  const bytes = Buffer.from(value, "base64url");
  return sshString(bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
}

function publicBlob(key: crypto.KeyObject): Buffer {
  const publicKey = crypto.createPublicKey(key).export({ format: "jwk" });
  if (key.asymmetricKeyType === "ed25519") return Buffer.concat([sshString("ssh-ed25519"), sshString(Buffer.from(publicKey.x!, "base64url"))]);
  if (key.asymmetricKeyType === "rsa") return Buffer.concat([sshString("ssh-rsa"), mpint(publicKey.e!), mpint(publicKey.n!)]);
  throw new Error("Unsupported key algorithm");
}

function openSshPrivateKey(key: crypto.KeyObject): string {
  const jwk = key.export({ format: "jwk" });
  const check = crypto.randomBytes(4);
  const publicKey = publicBlob(key);
  let parameters: Buffer[];
  if (key.asymmetricKeyType === "ed25519") {
    const publicBytes = Buffer.from(jwk.x!, "base64url");
    parameters = [sshString("ssh-ed25519"), sshString(publicBytes), sshString(Buffer.concat([Buffer.from(jwk.d!, "base64url"), publicBytes]))];
  } else {
    parameters = [sshString("ssh-rsa"), ...[jwk.n!, jwk.e!, jwk.d!, jwk.qi!, jwk.p!, jwk.q!].map(mpint)];
  }
  const privateKey = Buffer.concat([check, check, ...parameters, sshString("")]);
  const padding = Buffer.from(Array.from({ length: (8 - privateKey.length % 8) % 8 }, (_, index) => index + 1));
  const payload = Buffer.concat([opensshMagic, sshString("none"), sshString("none"), sshString(""), uint32(1), sshString(publicKey), sshString(Buffer.concat([privateKey, padding]))]);
  const encoded = payload.toString("base64");
  const lines: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += 70) lines.push(encoded.slice(offset, offset + 70));
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join("\n")}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

class SshReader {
  offset = 0;

  constructor(readonly bytes: Buffer) {}

  uint32(): number {
    if (this.offset + 4 > this.bytes.length) throw new Error("Truncated SSH integer");
    const value = this.bytes.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  string(): Buffer {
    const length = this.uint32();
    if (length > this.bytes.length - this.offset) throw new Error("Truncated SSH string");
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  mpint(): Buffer {
    const bytes = this.string();
    if (!bytes.length || bytes[0] & 0x80 || (bytes[0] === 0 && (bytes.length < 2 || !(bytes[1] & 0x80)))) throw new Error("Invalid SSH positive integer");
    return bytes[0] === 0 ? bytes.subarray(1) : bytes;
  }
}

function bigInteger(bytes: Buffer): bigint {
  return BigInt(`0x${bytes.toString("hex")}`);
}

function unsignedBase64(value: bigint): string {
  const hex = value.toString(16);
  return Buffer.from(hex.length % 2 ? `0${hex}` : hex, "hex").toString("base64url");
}

function parseOpenSsh(source: string): crypto.KeyObject {
  const lines = source.trim().split("\n").map(line => line.trim());
  if (lines.shift() !== "-----BEGIN OPENSSH PRIVATE KEY-----" || lines.pop() !== "-----END OPENSSH PRIVATE KEY-----") throw new Error("Invalid SSH envelope");
  const encoded = lines.join("");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded || !bytes.subarray(0, opensshMagic.length).equals(opensshMagic)) throw new Error("Invalid SSH payload");
  const outer = new SshReader(bytes.subarray(opensshMagic.length));
  if (outer.string().toString() !== "none" || outer.string().toString() !== "none" || outer.string().length !== 0 || outer.uint32() !== 1) throw new Error("Encrypted or multiple SSH keys are unsupported");
  const publicKey = outer.string();
  const privateBytes = outer.string();
  if (outer.offset !== outer.bytes.length || privateBytes.length % 8 !== 0) throw new Error("Invalid SSH block length");
  const reader = new SshReader(privateBytes);
  if (reader.uint32() !== reader.uint32()) throw new Error("Invalid SSH check integers");
  const algorithm = reader.string().toString();
  let key: crypto.KeyObject;
  if (algorithm === "ssh-ed25519") {
    const publicBytes = reader.string();
    const privateBytes = reader.string();
    if (publicBytes.length !== 32 || privateBytes.length !== 64 || !privateBytes.subarray(32).equals(publicBytes)) throw new Error("Invalid Ed25519 key");
    key = crypto.createPrivateKey({ format: "jwk", key: { kty: "OKP", crv: "Ed25519", x: publicBytes.toString("base64url"), d: privateBytes.subarray(0, 32).toString("base64url") } });
    if (crypto.createPublicKey(key).export({ format: "jwk" }).x !== publicBytes.toString("base64url")) throw new Error("Mismatched Ed25519 key");
  } else if (algorithm === "ssh-rsa") {
    const modulus = reader.mpint();
    const exponent = reader.mpint();
    const secret = reader.mpint();
    const coefficient = reader.mpint();
    const prime = reader.mpint();
    const otherPrime = reader.mpint();
    const primeValue = bigInteger(prime);
    const otherPrimeValue = bigInteger(otherPrime);
    const secretValue = bigInteger(secret);
    const exponentValue = bigInteger(exponent);
    if (primeValue <= 2n || otherPrimeValue <= 2n || primeValue === otherPrimeValue || primeValue * otherPrimeValue !== bigInteger(modulus) || exponentValue * secretValue % (primeValue - 1n) !== 1n || exponentValue * secretValue % (otherPrimeValue - 1n) !== 1n || bigInteger(coefficient) * otherPrimeValue % primeValue !== 1n) throw new Error("Inconsistent RSA key");
    key = crypto.createPrivateKey({ format: "jwk", key: { kty: "RSA", n: modulus.toString("base64url"), e: exponent.toString("base64url"), d: secret.toString("base64url"), p: prime.toString("base64url"), q: otherPrime.toString("base64url"), qi: coefficient.toString("base64url"), dp: unsignedBase64(secretValue % (primeValue - 1n)), dq: unsignedBase64(secretValue % (otherPrimeValue - 1n)) } });
  } else throw new Error("Unsupported SSH key algorithm");
  reader.string();
  const padding = privateBytes.subarray(reader.offset);
  if (padding.length > 7 || padding.some((byte, index) => byte !== index + 1) || !publicBlob(key).equals(publicKey)) throw new Error("Invalid SSH padding or public key");
  return key;
}

export function transformSshKey(source: string, format: SshPrivateKeyFormat): string {
  if (!["openssh", "pkcs1", "pkcs8"].includes(format)) throw new Error("Unsupported SSH private key format");
  let key: crypto.KeyObject;
  try {
    key = source.trimStart().startsWith("-----BEGIN OPENSSH PRIVATE KEY-----") ? parseOpenSsh(source) : crypto.createPrivateKey(source);
    if (!["rsa", "ed25519"].includes(key.asymmetricKeyType!)) throw new Error("Unsupported key algorithm");
  } catch {
    throw new Error("Invalid or unsupported SSH private key");
  }
  if (format === "pkcs1" && key.asymmetricKeyType !== "rsa") throw new Error("PKCS1 requires an RSA private key");
  return format === "openssh" ? openSshPrivateKey(key) : key.export({ format: "pem", type: format }).toString();
}

export async function generateSshKey(type = "ed25519"): Promise<GeneratedSshKey> {
  const normalized = type.toLowerCase();
  const bits: Record<string, number> = { rsa: 4096, rsa2048: 2048, rsa3072: 3072, rsa4096: 4096 };
  if (normalized !== "ed25519" && !Object.hasOwn(bits, normalized)) throw new Error("Unsupported SSH key type");
  const key = await new Promise<crypto.KeyObject>((resolve, reject) => {
    const receive = (error: Error | null, _publicKey: crypto.KeyObject, privateKey: crypto.KeyObject) => {
      if (error) reject(error);
      else resolve(privateKey);
    };
    if (normalized === "ed25519") crypto.generateKeyPair("ed25519", {}, receive);
    else crypto.generateKeyPair("rsa", { modulusLength: bits[normalized], publicExponent: 65537 }, receive);
  }).catch(() => { throw new Error("SSH key generation failed"); });
  const publicKey = publicBlob(key);
  const algorithm = key.asymmetricKeyType === "ed25519" ? "ssh-ed25519" : "ssh-rsa";
  return {
    category: "SSH_KEY",
    fields: [
      { id: "private_key", label: "private key", type: "SSHKEY", value: openSshPrivateKey(key) },
      { id: "public_key", label: "public key", type: "STRING", value: `${algorithm} ${publicKey.toString("base64")}` },
      { id: "fingerprint", label: "fingerprint", type: "STRING", value: `SHA256:${crypto.createHash("sha256").update(publicKey).digest("base64").split("=")[0]}` },
      { id: "key_type", label: "key type", type: "STRING", value: normalized === "ed25519" ? "ed25519" : `rsa${bits[normalized]}` },
    ],
  };
}
