import type { GhOpenSslProvider, GhSshKeyInfo, GhSshKeyPair, GhSshProvider } from "./types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBytes(input: Uint8Array | string): Uint8Array {
  return typeof input === "string" ? encoder.encode(input) : input;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    result +=
      BASE64_CHARS[(n >>> 18) & 63]! +
      BASE64_CHARS[(n >>> 12) & 63]! +
      BASE64_CHARS[(n >>> 6) & 63]! +
      BASE64_CHARS[n & 63]!;
  }
  if (i < bytes.length) {
    const remaining = bytes.length - i;
    const n = (bytes[i]! << 16) | (remaining > 1 ? bytes[i + 1]! << 8 : 0);
    result += BASE64_CHARS[(n >>> 18) & 63]!;
    result += BASE64_CHARS[(n >>> 12) & 63]!;
    result += remaining > 1 ? BASE64_CHARS[(n >>> 6) & 63]! : "=";
    result += "=";
  }
  return result;
}

export function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/[\r\n\s]/gu, "");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (ch === "=") break;
    const val = BASE64_CHARS.indexOf(ch);
    if (val === -1) continue;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >>> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function sha1Sync(input: Uint8Array | string): Uint8Array {
  const data = toBytes(input);
  const ml = data.length * 8;
  const padLen = ((data.length + 8) >>> 6) + 1;
  const words = new Uint32Array(padLen * 16);
  for (let i = 0; i < data.length; i++) {
    words[i >>> 2] = (words[i >>> 2] ?? 0) | (data[i]! << (24 - (i & 3) * 8));
  }
  words[data.length >>> 2] = (words[data.length >>> 2] ?? 0) | (0x80 << (24 - (data.length & 3) * 8));
  words[words.length - 2] = Math.floor(ml / 0x100000000);
  words[words.length - 1] = ml >>> 0;

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[i + t]!;
    for (let t = 16; t < 80; t++) {
      const x = w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!;
      w[t] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t++) {
      let f = 0;
      let k = 0;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]!) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const view = new DataView(out.buffer);
  view.setUint32(0, h0, false);
  view.setUint32(4, h1, false);
  view.setUint32(8, h2, false);
  view.setUint32(12, h3, false);
  view.setUint32(16, h4, false);
  return out;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

export function sha256Sync(input: Uint8Array | string): Uint8Array {
  const data = toBytes(input);
  const ml = data.length * 8;
  const padLen = ((data.length + 8) >>> 6) + 1;
  const words = new Uint32Array(padLen * 16);
  for (let i = 0; i < data.length; i++) {
    words[i >>> 2] = (words[i >>> 2] ?? 0) | (data[i]! << (24 - (i & 3) * 8));
  }
  words[data.length >>> 2] = (words[data.length >>> 2] ?? 0) | (0x80 << (24 - (data.length & 3) * 8));
  words[words.length - 2] = Math.floor(ml / 0x100000000);
  words[words.length - 1] = ml >>> 0;

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[i + t]!;
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
      const s1 = rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[t]! + w[t]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const view = new DataView(out.buffer);
  view.setUint32(0, h0, false);
  view.setUint32(4, h1, false);
  view.setUint32(8, h2, false);
  view.setUint32(12, h3, false);
  view.setUint32(16, h4, false);
  view.setUint32(20, h5, false);
  view.setUint32(24, h6, false);
  view.setUint32(28, h7, false);
  return out;
}

export function hmacSha256Sync(keyInput: Uint8Array | string, messageInput: Uint8Array | string): Uint8Array {
  let key = toBytes(keyInput);
  const message = toBytes(messageInput);
  if (key.length > 64) key = sha256Sync(key);
  const paddedKey = new Uint8Array(64);
  paddedKey.set(key);
  const oKeyPad = new Uint8Array(64);
  const iKeyPad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    oKeyPad[i] = paddedKey[i]! ^ 0x5c;
    iKeyPad[i] = paddedKey[i]! ^ 0x36;
  }
  const inner = new Uint8Array(64 + message.length);
  inner.set(iKeyPad, 0);
  inner.set(message, 64);
  const innerHash = sha256Sync(inner);
  const outer = new Uint8Array(64 + 32);
  outer.set(oKeyPad, 0);
  outer.set(innerHash, 64);
  return sha256Sync(outer);
}

export function createDefaultOpenSslProvider(
  overrides: Partial<GhOpenSslProvider> = {}
): GhOpenSslProvider {
  let counter = 1;
  const defaultProvider: GhOpenSslProvider = {
    async sha1(data) {
      return sha1Sync(data);
    },
    async sha256(data) {
      return sha256Sync(data);
    },
    async hmacSha256(key, data) {
      return hmacSha256Sync(key, data);
    },
    randomBytes(size) {
      const seed = sha256Sync(`safe-bash-gh-openssl-rng-${counter++}-${size}`);
      const out = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        out[i] = seed[i % seed.length]! ^ ((i * 31) & 0xff);
      }
      return out;
    },
    async generateRsaKeyPair(bits = 2048) {
      const seed = sha256Sync(`rsa-${bits}-${counter++}`);
      const pubB64 = bytesToBase64(seed);
      const privB64 = bytesToBase64(hmacSha256Sync(seed, "private"));
      const fp = `SHA256:${bytesToBase64(sha256Sync(pubB64)).replace(/=+$/u, "")}`;
      return {
        publicKeyPem: `-----BEGIN PUBLIC KEY-----\n${pubB64}\n-----END PUBLIC KEY-----\n`,
        privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${privB64}\n-----END PRIVATE KEY-----\n`,
        fingerprint: fp,
      };
    },
    async x509SelfSignedCert({ commonName, days = 365 }) {
      const certBytes = sha256Sync(`x509:${commonName}:${days}:${counter++}`);
      const privBytes = hmacSha256Sync(certBytes, commonName);
      const fp = bytesToHex(sha256Sync(certBytes));
      return {
        certPem: `-----BEGIN CERTIFICATE-----\n${bytesToBase64(certBytes)}\n-----END CERTIFICATE-----\n`,
        privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${bytesToBase64(privBytes)}\n-----END PRIVATE KEY-----\n`,
        sha256Fingerprint: fp,
      };
    },
    async encryptSecretForGitHub(secretValue, publicKeyBase64, keyId) {
      const mac = hmacSha256Sync(publicKeyBase64, `${keyId}:${secretValue}`);
      const valueBytes = toBytes(secretValue);
      const sealed = new Uint8Array(mac.length + valueBytes.length);
      sealed.set(mac, 0);
      for (let i = 0; i < valueBytes.length; i++) {
        sealed[mac.length + i] = valueBytes[i]! ^ mac[i % mac.length]!;
      }
      return {
        encrypted_value: bytesToBase64(sealed),
        key_id: keyId,
      };
    },
    async verifyAttestationSignature(bundle, artifactBytes) {
      const digest = bytesToHex(sha256Sync(artifactBytes));
      const record = (bundle && typeof bundle === "object" ? bundle : {}) as Record<string, unknown>;
      const expectedDigest = typeof record.subjectDigest === "string" ? record.subjectDigest : digest;
      const verified = expectedDigest === digest && record.invalid !== true;
      return {
        verified,
        subjectDigest: `sha256:${digest}`,
        issuer: typeof record.issuer === "string" ? record.issuer : "https://token.actions.githubusercontent.com",
        repository: typeof record.repository === "string" ? record.repository : "octocat/Hello-World",
        workflowRef:
          typeof record.workflowRef === "string"
            ? record.workflowRef
            : "octocat/Hello-World/.github/workflows/release.yml@refs/heads/main",
      };
    },
  };

  return {
    ...defaultProvider,
    ...overrides,
  };
}

function computeSshFingerprint(base64Data: string, keyType: string): {
  readonly fingerprint: string;
  readonly algorithm: string;
  readonly bits: number;
} {
  const raw = base64ToBytes(base64Data);
  const digest = sha256Sync(raw.length > 0 ? raw : base64Data);
  const fp = `SHA256:${bytesToBase64(digest).replace(/=+$/u, "")}`;
  const algorithm =
    keyType.includes("ed25519")
      ? "ED25519"
      : keyType.includes("ecdsa")
        ? "ECDSA"
        : keyType.includes("rsa")
          ? "RSA"
          : "SSH";
  const bits = algorithm === "ED25519" ? 256 : algorithm === "ECDSA" ? 256 : 3072;
  return { fingerprint: fp, algorithm, bits };
}

export function createDefaultSshProvider(
  overrides: Partial<GhSshProvider> = {},
  defaultUser = "octocat"
): GhSshProvider {
  let keyCounter = 1;

  const parsePublicKey = (publicKey: string): GhSshKeyInfo => {
    const trimmed = publicKey.trim();
    const parts = trimmed.split(/\s+/u);
    const keyType = parts[0] ?? "ssh-ed25519";
    const base64Data = parts[1] ?? bytesToBase64(sha256Sync(trimmed));
    const comment = parts.slice(2).join(" ");
    const meta = computeSshFingerprint(base64Data, keyType);
    return {
      keyType,
      base64Data,
      comment,
      fingerprint: meta.fingerprint,
      algorithm: meta.algorithm,
      bits: meta.bits,
    };
  };

  const defaultProvider: GhSshProvider = {
    async keygen(options = {}) {
      const type = options.type ?? "ed25519";
      const keyType =
        type === "rsa" ? "ssh-rsa" : type === "ecdsa" ? "ecdsa-sha2-nistp256" : "ssh-ed25519";
      const comment = options.comment ?? `${defaultUser}@safe-bash`;
      const seed = sha256Sync(`openssh-key:${keyType}:${comment}:${keyCounter++}`);
      const base64Data = bytesToBase64(seed);
      const publicKey = `${keyType} ${base64Data} ${comment}`;
      const privateKey = `-----BEGIN OPENSSH PRIVATE KEY-----\n${bytesToBase64(
        hmacSha256Sync(seed, options.passphrase ?? "nopass")
      )}\n-----END OPENSSH PRIVATE KEY-----\n`;
      const meta = computeSshFingerprint(base64Data, keyType);
      const pair: GhSshKeyPair = {
        publicKey,
        privateKey,
        fingerprint: meta.fingerprint,
        algorithm: meta.algorithm,
        bits: options.bits ?? meta.bits,
        comment,
      };
      return pair;
    },
    async fingerprint(publicKey) {
      return parsePublicKey(publicKey);
    },
    parsePublicKey,
    async sign(payload, privateKey) {
      const sigBytes = hmacSha256Sync(privateKey, payload);
      return `-----BEGIN SSH SIGNATURE-----\n${bytesToBase64(sigBytes)}\n-----END SSH SIGNATURE-----`;
    },
    async verify(payload, signature, _publicKey) {
      return signature.includes("BEGIN SSH SIGNATURE") && toBytes(payload).length >= 0;
    },
    async connect(host, user, command) {
      if (!command) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `Hi ${defaultUser}! You've successfully authenticated, but ${host} (${user}) does not provide shell access.\n`,
        };
      }
      return {
        exitCode: 0,
        stdout: `OK ${user}@${host}:${command}\n`,
        stderr: "",
      };
    },
  };

  return {
    ...defaultProvider,
    ...overrides,
  };
}

export function decodeUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}
