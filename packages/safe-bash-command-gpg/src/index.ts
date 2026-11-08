import {
  FsError,
  commandRuntimeIdentity,
  getCommandArguments,
  readBytes,
  writeText,
  type ByteSource,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import { yieldTurn } from "safe-bash-contracts/yield";

export interface GpgLimits {
  readonly maxBufferedBytes: number;
}

export interface GpgCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<GpgLimits>;
  readonly maxBufferedBytes?: number;
}

export type GpgOptions = GpgCommandsOptions;

export function settings(options: GpgCommandsOptions = {}): GpgLimits {
  const limits: GpgLimits = {
    maxBufferedBytes: options.limits?.maxBufferedBytes ?? options.maxBufferedBytes ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`Invalid gpg limit: ${name}`);
    }
  }
  return Object.freeze(limits);
}

const pathPosix = {
  resolve(cwd: string, target: string): string {
    const raw = target.startsWith("/") ? target : cwd.endsWith("/") ? cwd + target : `${cwd}/${target}`;
    const parts = raw.split("/");
    const stack: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return `/${stack.join("/")}`;
  },
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array, wrapWidth = 0): string {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.byteLength; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.byteLength ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.byteLength ? bytes[i + 2]! : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += table[(n >> 18) & 63];
    out += table[(n >> 12) & 63];
    out += i + 1 < bytes.byteLength ? table[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.byteLength ? table[n & 63] : "=";
  }
  if (wrapWidth <= 0) return out;
  const lines: string[] = [];
  for (let i = 0; i < out.length; i += wrapWidth) {
    lines.push(out.slice(i, i + wrapWidth));
  }
  return lines.join("\n");
}

function base64ToBytes(input: string): Uint8Array {
  let clean = input.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/=]/g, "");
  while (clean.length % 4 !== 0) clean += "=";
  const out: number[] = [];
  const val = (ch: string): number => {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) return c - 65;
    if (c >= 97 && c <= 122) return c - 71;
    if (c >= 48 && c <= 57) return c + 4;
    if (c === 43) return 62;
    if (c === 47) return 63;
    return -1;
  };
  for (let i = 0; i + 3 < clean.length; i += 4) {
    const v0 = val(clean[i]!);
    const v1 = val(clean[i + 1]!);
    if (v0 < 0 || v1 < 0) break;
    out.push(((v0 << 2) | (v1 >> 4)) & 0xff);
    if (clean[i + 2] !== "=") {
      const v2 = val(clean[i + 2]!);
      if (v2 < 0) break;
      out.push(((v1 & 0x0f) << 4) | (v2 >> 2));
      if (clean[i + 3] !== "=") {
        const v3 = val(clean[i + 3]!);
        if (v3 < 0) break;
        out.push(((v2 & 0x03) << 6) | v3);
      }
    }
  }
  return new Uint8Array(out);
}

function pgpCrc24(data: Uint8Array): string {
  let crc = 0xb704ce;
  for (let i = 0; i < data.byteLength; i++) {
    crc ^= data[i]! << 16;
    for (let j = 0; j < 8; j++) {
      crc <<= 1;
      if ((crc & 0x1000000) !== 0) crc ^= 0x1864cfb;
    }
  }
  const b = new Uint8Array([(crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]);
  return `=${bytesToBase64(b)}`;
}

async function createOpenPgpDetachedSignature(
  seed: Uint8Array,
  pubKey: Uint8Array,
  signerUid: string,
  payload: Uint8Array,
): Promise<{ armor: string; keyIdHex: string }> {
  const seedBuf = seed.buffer.slice(seed.byteOffset, seed.byteOffset + seed.byteLength) as ArrayBuffer;
  const pubBuf = pubKey.buffer.slice(pubKey.byteOffset, pubKey.byteOffset + pubKey.byteLength) as ArrayBuffer;
  const fpDigest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", pubBuf));
  const keyId = fpDigest.slice(24, 32);
  const keyIdHex = bytesToHex(keyId).toUpperCase();

  const hashedSub: number[] = [];
  hashedSub.push(5, 2, 0x60, 0x00, 0x00, 0x00); // creation time
  hashedSub.push(9, 16, ...keyId); // issuer key ID
  const uidBytes = textEncoder.encode(signerUid);
  if (uidBytes.byteLength < 190) {
    hashedSub.push(1 + uidBytes.byteLength, 28, ...uidBytes);
  }
  const pubKeySub = [33, 0x80 | 28, ...pubKey];

  const sigHeader: number[] = [
    4,
    0x00,
    22,
    8,
    (hashedSub.length >>> 8) & 0xff,
    hashedSub.length & 0xff,
    ...hashedSub,
  ];
  const hashTarget = new Uint8Array(payload.byteLength + sigHeader.length + 6);
  hashTarget.set(payload, 0);
  hashTarget.set(sigHeader, payload.byteLength);
  const hLen = sigHeader.length;
  hashTarget.set(
    [4, 0xff, (hLen >>> 24) & 0xff, (hLen >>> 16) & 0xff, (hLen >>> 8) & 0xff, hLen & 0xff],
    payload.byteLength + sigHeader.length,
  );

  const hashTargetBuf = hashTarget.buffer.slice(hashTarget.byteOffset, hashTarget.byteOffset + hashTarget.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", hashTargetBuf));

  const toB64Url = (b: Uint8Array) => bytesToBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const privKey = await globalThis.crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", d: toB64Url(seed), x: toB64Url(pubKey), key_ops: ["sign"] },
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const digestBuf = digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength) as ArrayBuffer;
  const sigBytes = new Uint8Array(await globalThis.crypto.subtle.sign({ name: "Ed25519" }, privKey, digestBuf));

  const body: number[] = [
    ...sigHeader,
    (pubKeySub.length >>> 8) & 0xff,
    pubKeySub.length & 0xff,
    ...pubKeySub,
    digest[0]!,
    digest[1]!,
    0x01,
    0x00,
    ...sigBytes.slice(0, 32),
    0x01,
    0x00,
    ...sigBytes.slice(32, 64),
  ];

  const packet: number[] = [0xc2];
  if (body.length < 192) {
    packet.push(body.length);
  } else {
    packet.push(0xff, (body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff);
  }
  packet.push(...body);
  const pktBytes = new Uint8Array(packet);
  const b64 = bytesToBase64(pktBytes, 64);
  const crc = pgpCrc24(pktBytes);
  const armor = `-----BEGIN PGP SIGNATURE-----\n\n${b64}\n${crc}\n-----END PGP SIGNATURE-----\n`;
  return { armor, keyIdHex };
}

async function verifyOpenPgpDetachedSignature(
  armor: string,
  payload: Uint8Array,
  keys: readonly StoredGpgKey[],
): Promise<{ valid: boolean; signerUid: string; keyIdHex: string }> {
  const b64 = armor
    .split("\n")
    .map(l => l.trim())
    .filter(l => !l.startsWith("-----") && !l.startsWith("=") && !l.includes(":") && l.length > 0)
    .join("");
  const pkt = base64ToBytes(b64);
  if (pkt.byteLength < 10 || pkt[0] !== 0xc2) {
    return { valid: false, signerUid: "", keyIdHex: "" };
  }
  let idx = 1;
  if (pkt[1]! < 192) idx = 2;
  else if (pkt[1] === 0xff) idx = 6;
  const body = pkt.slice(idx);
  if (body.byteLength < 6 || body[0] !== 4) {
    return { valid: false, signerUid: "", keyIdHex: "" };
  }
  const hashedLen = (body[4]! << 8) | body[5]!;
  const sigHeaderEnd = 6 + hashedLen;
  const sigHeader = body.slice(0, sigHeaderEnd);

  let keyIdHex = "0000000000000000";
  let signerUid = "unknown";
  let sp = 6;
  while (sp < sigHeaderEnd) {
    const slen = body[sp]!;
    if (sp + 1 + slen > sigHeaderEnd || slen === 0) break;
    const stype = body[sp + 1]!;
    const sdata = body.slice(sp + 2, sp + 1 + slen);
    if (stype === 16 && sdata.byteLength === 8) keyIdHex = bytesToHex(sdata).toUpperCase();
    else if (stype === 28) signerUid = textDecoder.decode(sdata);
    sp += 1 + slen;
  }

  const unhashedLen = (body[sigHeaderEnd]! << 8) | body[sigHeaderEnd + 1]!;
  const unhashedEnd = sigHeaderEnd + 2 + unhashedLen;
  let pubKey: Uint8Array | undefined;
  let usp = sigHeaderEnd + 2;
  while (usp < unhashedEnd) {
    const slen = body[usp]!;
    if (usp + 1 + slen > unhashedEnd || slen === 0) break;
    const stype = body[usp + 1]!;
    const sdata = body.slice(usp + 2, usp + 1 + slen);
    if (stype === (0x80 | 28) && sdata.byteLength === 32) pubKey = sdata;
    usp += 1 + slen;
  }
  if (!pubKey || unhashedEnd + 2 + 68 > body.byteLength) {
    return { valid: false, signerUid, keyIdHex };
  }
  const fingerprint = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(pubKey)));
  const derivedKeyId = bytesToHex(fingerprint.slice(24, 32)).toUpperCase();
  const trustedKey = keys.find(key => key.keyIdHex === derivedKeyId && key.pubHex.toLowerCase() === bytesToHex(pubKey));
  if (keyIdHex !== derivedKeyId || !trustedKey) {
    return { valid: false, signerUid, keyIdHex };
  }
  signerUid = trustedKey.uid;
  const mpiStart = unhashedEnd + 2;
  const sigBytes = new Uint8Array(64);
  sigBytes.set(body.slice(mpiStart + 2, mpiStart + 34), 0);
  sigBytes.set(body.slice(mpiStart + 36, mpiStart + 68), 32);

  const hashTarget = new Uint8Array(payload.byteLength + sigHeader.byteLength + 6);
  hashTarget.set(payload, 0);
  hashTarget.set(sigHeader, payload.byteLength);
  const hLen = sigHeader.byteLength;
  hashTarget.set(
    [4, 0xff, (hLen >>> 24) & 0xff, (hLen >>> 16) & 0xff, (hLen >>> 8) & 0xff, hLen & 0xff],
    payload.byteLength + sigHeader.byteLength,
  );
  const hashTargetBuf = hashTarget.buffer.slice(hashTarget.byteOffset, hashTarget.byteOffset + hashTarget.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", hashTargetBuf));

  const toB64Url = (b: Uint8Array) => bytesToBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const cryptoPub = await globalThis.crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", x: toB64Url(pubKey), key_ops: ["verify"] },
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const sigBuf = sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer;
  const digestBuf = digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength) as ArrayBuffer;
  const valid = await globalThis.crypto.subtle.verify({ name: "Ed25519" }, cryptoPub, sigBuf, digestBuf);
  return { valid, signerUid, keyIdHex };
}

const SYM_MAGIC = new Uint8Array([0x50, 0x47, 0x50, 0x53, 0x59, 0x4d, 0x31, 0x00]); // "PGPSYM1\0"

async function deriveSymmetricKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    textEncoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: 10000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptSymmetric(plaintext: Uint8Array, passphrase: string, armor: boolean): Promise<Uint8Array> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveSymmetricKey(passphrase, salt);
  const plainBuf = plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer;
  const cipherBuf = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
      key,
      plainBuf,
    ),
  );
  const envelope = new Uint8Array(SYM_MAGIC.byteLength + salt.byteLength + iv.byteLength + cipherBuf.byteLength);
  envelope.set(SYM_MAGIC, 0);
  envelope.set(salt, SYM_MAGIC.byteLength);
  envelope.set(iv, SYM_MAGIC.byteLength + salt.byteLength);
  envelope.set(cipherBuf, SYM_MAGIC.byteLength + salt.byteLength + iv.byteLength);
  if (!armor) return envelope;
  const b64 = bytesToBase64(envelope, 64);
  return textEncoder.encode(`-----BEGIN PGP MESSAGE-----\n\n${b64}\n-----END PGP MESSAGE-----\n`);
}

async function decryptSymmetric(input: Uint8Array, passphrase: string): Promise<Uint8Array> {
  let envelope = input;
  const head = textDecoder.decode(input.subarray(0, Math.min(64, input.byteLength)));
  if (head.includes("-----BEGIN PGP MESSAGE-----")) {
    const b64 = textDecoder
      .decode(input)
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("-----") && !line.startsWith("="))
      .join("");
    envelope = base64ToBytes(b64);
  }
  const minLen = SYM_MAGIC.byteLength + 16 + 12 + 16;
  if (envelope.byteLength < minLen) {
    throw new Error("decryption failed: Bad session key");
  }
  for (let i = 0; i < SYM_MAGIC.byteLength; i++) {
    if (envelope[i] !== SYM_MAGIC[i]) {
      throw new Error("decryption failed: Bad session key");
    }
  }
  const salt = envelope.subarray(SYM_MAGIC.byteLength, SYM_MAGIC.byteLength + 16);
  const iv = envelope.subarray(SYM_MAGIC.byteLength + 16, SYM_MAGIC.byteLength + 28);
  const cipher = envelope.subarray(SYM_MAGIC.byteLength + 28);
  const key = await deriveSymmetricKey(passphrase, salt);
  try {
    const plainBuf = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
      key,
      cipher.buffer.slice(cipher.byteOffset, cipher.byteOffset + cipher.byteLength) as ArrayBuffer,
    );
    return new Uint8Array(plainBuf);
  } catch {
    throw new Error("decryption failed: Bad session key");
  }
}

interface StoredGpgKey {
  uid: string;
  keyIdHex: string;
  seedHex: string;
  pubHex: string;
}

const KEYRING_PATH = "/home/user/.gnupg/keyring.json";

async function loadKeyring(context: CommandContext): Promise<StoredGpgKey[]> {
  try {
    const raw = await context.fs.readFile(KEYRING_PATH);
    return JSON.parse(textDecoder.decode(raw)) as StoredGpgKey[];
  } catch {
    return [];
  }
}

async function saveKeyring(context: CommandContext, keys: StoredGpgKey[]): Promise<void> {
  await context.fs.mkdir("/home/user/.gnupg", { recursive: true });
  const bytes = textEncoder.encode(JSON.stringify(keys, null, 2));
  await writeFileOutput(context, bytes, data => context.fs.writeFile(KEYRING_PATH, data, { signal: context.signal }));
}

async function ensureKeyForUid(context: CommandContext, uid: string): Promise<{ seed: Uint8Array; pubKey: Uint8Array; uid: string; keyIdHex: string }> {
  const keys = await loadKeyring(context);
  const found = keys.find(k => k.uid.includes(uid) || k.keyIdHex.endsWith(uid.toUpperCase()));
  if (found) {
    const fromHex = (h: string) => new Uint8Array(h.match(/.{1,2}/g)!.map(b => Number.parseInt(b, 16)));
    return {
      seed: fromHex(found.seedHex),
      pubKey: fromHex(found.pubHex),
      uid: found.uid,
      keyIdHex: found.keyIdHex,
    };
  }
  const seed = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", textEncoder.encode(`gpg-key-seed:${uid}`)));
  const kp = (await globalThis.crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as { privateKey: CryptoKey; publicKey: CryptoKey };
  const jwk = await globalThis.crypto.subtle.exportKey("jwk", kp.privateKey);
  const realSeed = base64ToBytes(jwk.d!);
  const realPub = base64ToBytes(jwk.x!);
  const pubBuf = realPub.buffer.slice(realPub.byteOffset, realPub.byteOffset + realPub.byteLength) as ArrayBuffer;
  const fp = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", pubBuf));
  const keyIdHex = bytesToHex(fp.slice(24, 32)).toUpperCase();
  keys.push({
    uid,
    keyIdHex,
    seedHex: bytesToHex(realSeed.byteLength === 32 ? realSeed : seed),
    pubHex: bytesToHex(realPub),
  });
  await saveKeyring(context, keys);
  return { seed: realSeed, pubKey: realPub, uid, keyIdHex };
}

async function collectSourceBytes(source: ByteSource, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let quantum = 0;
  let chunksRead = 0;
  for await (const chunk of readBytes(source, signal)) {
    total += chunk.byteLength;
    signal.throwIfAborted();
    quantum += Math.max(1, chunk.byteLength);
    if (quantum >= 16384 || ++chunksRead >= 128) {
      quantum = 0;
      chunksRead = 0;
      await yieldTurn(signal);
    }
    if (total > maxBytes) {
      throw new PublicDiagnostic(`input exceeds maximum buffered size of ${maxBytes} bytes`);
    }
    if (chunk.byteLength > 0) chunks.push(chunk);
  }
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0]!;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readLimitedFile(context: CommandContext, path: string, maxBytes: number): Promise<Uint8Array> {
  try {
    const bytes = await context.fs.readFile(path, { ...(maxBytes === Infinity ? {} : { maxBytes }), signal: context.signal });
    if (bytes.byteLength > maxBytes) {
      throw new PublicDiagnostic(`input exceeds maximum buffered size of ${maxBytes} bytes`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof FsError && error.code === "EFBIG") {
      throw new PublicDiagnostic(`input exceeds maximum buffered size of ${maxBytes} bytes`);
    }
    throw error;
  }
}

export function createGpgCommand(options: GpgCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name: "gpg",
    description: "OpenPGP key management and digital signature tool",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      const args = getCommandArguments(context).args;
      const maxBytes = Math.min(
        limits.maxBufferedBytes,
        (context as { limits?: { maxInputBytes?: number } }).limits?.maxInputBytes ?? limits.maxBufferedBytes,
      );

      let version = false;
      let detachSign = false;
      let verify = false;
      let listKeys = false;
      let quickGenKey = false;
      let exportKeys = false;
      let importKeys = false;
      let symmetric = false;
      let decrypt = false;
      let armor = false;
      let withColons = false;
      let passphrase: string | undefined;
      let passphraseFile: string | undefined;
      let passphraseFd: string | undefined;
      let signerUid = "Git User <user@example.com>";
      let statusFd: string | undefined;
      let outFile: string | undefined;
      const positionals: string[] = [];

      for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if (a === "--") { positionals.push(...args.slice(i + 1)); break; }
        else if (a === "--version") version = true;
        else if (a === "--detach-sign" || a === "-b" || a === "-bsau" || a === "-bsa") detachSign = true;
        else if (a === "--verify") verify = true;
        else if (a === "-c" || a === "--symmetric") symmetric = true;
        else if (a === "-d" || a === "--decrypt") decrypt = true;
        else if (a === "-a" || a === "--armor") armor = true;
        else if (a === "--list-keys" || a === "-k" || a === "--list-secret-keys" || a === "-K") listKeys = true;
        else if (a === "--quick-generate-key" || a === "--quick-gen-key" || a === "--gen-key" || a === "--full-generate-key")
          quickGenKey = true;
        else if (a === "--export") exportKeys = true;
        else if (a === "--import") importKeys = true;
        else if (a === "--with-colons") withColons = true;
        else if ((a === "-u" || a === "--local-user") && i + 1 < args.length) signerUid = args[++i]!;
        else if (a.startsWith("-bsau") && a.length > 5) {
          detachSign = true;
          signerUid = a.slice(5);
        } else if (a === "--status-fd" && i + 1 < args.length) statusFd = args[++i];
        else if (a.startsWith("--status-fd=")) statusFd = a.slice("--status-fd=".length);
        else if (a === "--passphrase" && i + 1 < args.length) passphrase = args[++i];
        else if (a.startsWith("--passphrase=")) passphrase = a.slice("--passphrase=".length);
        else if (a === "--passphrase-file" && i + 1 < args.length) passphraseFile = args[++i];
        else if (a.startsWith("--passphrase-file=")) passphraseFile = a.slice("--passphrase-file=".length);
        else if (a === "--passphrase-fd" && i + 1 < args.length) passphraseFd = args[++i];
        else if (a.startsWith("--passphrase-fd=")) passphraseFd = a.slice("--passphrase-fd=".length);
        else if ((a === "--pinentry-mode" || a === "--cipher-algo" || a === "--s2k-digest-algo" || a === "--s2k-cipher-algo" || a === "--s2k-mode" || a === "--s2k-count") && i + 1 < args.length) {
          i++;
        } else if (
          a.startsWith("--pinentry-mode=") ||
          a.startsWith("--cipher-algo=") ||
          a.startsWith("--s2k-digest-algo=") ||
          a.startsWith("--s2k-cipher-algo=") ||
          a.startsWith("--s2k-mode=") ||
          a.startsWith("--s2k-count=")
        ) {
          continue;
        }
        else if ((a === "-o" || a === "--output") && i + 1 < args.length) outFile = args[++i];
        else if (a === "--batch" || a === "--yes" || a === "--no-tty" || a === "-q" || a === "--quiet" || a === "-s" || a === "--sign" || a === "--help" || a === "-h") continue;
        else if (a.startsWith("-")) {
          await writeText(context.stderr, `gpg: unknown option: ${a}\n`);
          return { exitCode: 2 };
        }
        else positionals.push(a);
      }

      if (version) {
        await writeText(context.stdout, "gpg (GnuPG) 2.4.5 (safe-bash)\nlibgcrypt 1.11.0\n");
        return { exitCode: 0 };
      }

      try {
        const resolvePassphrase = async (): Promise<string> => {
          if (passphraseFile) {
            const raw = await readLimitedFile(context, pathPosix.resolve(context.cwd, passphraseFile), maxBytes);
            return textDecoder.decode(raw).replace(/\r?\n[\s\S]*$/, "");
          }
          if (passphrase !== undefined) return passphrase;
          if (passphraseFd === "0" && positionals.length > 0) {
            const raw = await collectSourceBytes(context.stdin, maxBytes, context.signal);
            return textDecoder.decode(raw).replace(/\r?\n[\s\S]*$/, "");
          }
          return "";
        };

        if (symmetric) {
          const secret = await resolvePassphrase();
          const payload = positionals[0] && positionals[0] !== "-"
            ? await readLimitedFile(context, pathPosix.resolve(context.cwd, positionals[0]), maxBytes)
            : await collectSourceBytes(context.stdin, maxBytes, context.signal);
          const encrypted = await encryptSymmetric(payload, secret, armor);
          const targetOut = outFile ?? (positionals[0] && positionals[0] !== "-" ? `${positionals[0]}${armor ? ".asc" : ".gpg"}` : undefined);
          if (targetOut && targetOut !== "-") {
            await writeFileOutput(context, encrypted, data =>
              context.fs.writeFile(pathPosix.resolve(context.cwd, targetOut), data, { signal: context.signal }),
            );
          } else {
            await context.stdout.write(encrypted);
          }
          return { exitCode: 0 };
        }

        if (decrypt) {
          const secret = await resolvePassphrase();
          const payload = positionals[0] && positionals[0] !== "-"
            ? await readLimitedFile(context, pathPosix.resolve(context.cwd, positionals[0]), maxBytes)
            : await collectSourceBytes(context.stdin, maxBytes, context.signal);
          const decrypted = await decryptSymmetric(payload, secret);
          if (outFile && outFile !== "-") {
            await writeFileOutput(context, decrypted, data =>
              context.fs.writeFile(pathPosix.resolve(context.cwd, outFile!), data, { signal: context.signal }),
            );
          } else {
            await context.stdout.write(decrypted);
          }
          return { exitCode: 0 };
        }

        if (quickGenKey) {
          const uid = positionals[0] ?? signerUid;
          const key = await ensureKeyForUid(context, uid);
          await writeText(context.stdout, `pub   ed25519/${key.keyIdHex} 2026-09-28 [SC]\nuid                 [ultimate] ${key.uid}\n`);
          return { exitCode: 0 };
        }

        if (listKeys) {
          const keys = await loadKeyring(context);
          const filtered = positionals.length === 0
            ? keys
            : keys.filter(k => positionals.some(q => k.uid.includes(q) || k.keyIdHex.includes(q.toUpperCase())));
          const lines: string[] = [];
          for (const k of filtered) {
            if (withColons) {
              lines.push(`sec:u:255:22:${k.keyIdHex}:1790553600:::u:::scESC:::+:::23::0:`);
              lines.push(`uid:u::::1790553600::${k.keyIdHex}::${k.uid}::::::::::0:`);
            } else {
              lines.push(`sec   ed25519/${k.keyIdHex} 2026-09-28 [SC]`);
              lines.push(`uid                 [ultimate] ${k.uid}`);
            }
          }
          await writeText(context.stdout, lines.length > 0 ? `${lines.join("\n")}\n` : "");
          return { exitCode: 0 };
        }

        if (exportKeys) {
          const keys = await loadKeyring(context);
          const armor = `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${bytesToBase64(textEncoder.encode(JSON.stringify(keys)), 64)}\n-----END PGP PUBLIC KEY BLOCK-----\n`;
          if (outFile) {
            await writeFileOutput(context, textEncoder.encode(armor), data =>
              context.fs.writeFile(pathPosix.resolve(context.cwd, outFile!), data, { signal: context.signal }),
            );
          } else {
            await writeText(context.stdout, armor);
          }
          return { exitCode: 0 };
        }

        if (importKeys) {
          const input = positionals[0]
            ? await readLimitedFile(context, pathPosix.resolve(context.cwd, positionals[0]), maxBytes)
            : await collectSourceBytes(context.stdin, maxBytes, context.signal);
          const b64 = textDecoder
            .decode(input)
            .split("\n")
            .filter(l => !l.startsWith("-----") && l.trim().length > 0)
            .join("");
          const imported = JSON.parse(textDecoder.decode(base64ToBytes(b64))) as StoredGpgKey[];
          const existing = await loadKeyring(context);
          for (const k of imported) {
            if (!existing.some(e => e.keyIdHex === k.keyIdHex)) existing.push(k);
          }
          await saveKeyring(context, existing);
          await writeText(context.stderr, `gpg: Total number processed: ${imported.length}\ngpg:               imported: ${imported.length}\n`);
          return { exitCode: 0 };
        }

        if (detachSign) {
          const payload = positionals[0]
            ? await readLimitedFile(context, pathPosix.resolve(context.cwd, positionals[0]), maxBytes)
            : await collectSourceBytes(context.stdin, maxBytes, context.signal);
          const key = await ensureKeyForUid(context, signerUid);
          const { armor, keyIdHex } = await createOpenPgpDetachedSignature(key.seed, key.pubKey, key.uid, payload);
          if (statusFd) {
            await writeText(context.stderr, `[GNUPG:] SIG_CREATED D 22 8 00 1609459200 ${keyIdHex}\n`);
          }
          if (outFile) {
            await writeFileOutput(context, textEncoder.encode(armor), data =>
              context.fs.writeFile(pathPosix.resolve(context.cwd, outFile!), data, { signal: context.signal }),
            );
          } else {
            await writeText(context.stdout, armor);
          }
          return { exitCode: 0 };
        }

        if (verify) {
          const sigPath = positionals[0];
          if (!sigPath) throw new PublicDiagnostic("missing signature file for --verify");
          const sigArmor = textDecoder.decode(await readLimitedFile(context, pathPosix.resolve(context.cwd, sigPath), maxBytes));
          const dataBytes = positionals[1]
            ? await readLimitedFile(context, pathPosix.resolve(context.cwd, positionals[1]), maxBytes)
            : await collectSourceBytes(context.stdin, maxBytes, context.signal);
          const res = await verifyOpenPgpDetachedSignature(sigArmor, dataBytes, await loadKeyring(context));
          if (!res.valid) {
            await writeText(context.stderr, `gpg: BAD signature from "${res.signerUid}"\n`);
            return { exitCode: 1 };
          }
          if (statusFd) {
            await writeText(
              context.stdout,
              `[GNUPG:] GOODSIG ${res.keyIdHex} ${res.signerUid}\n[GNUPG:] VALIDSIG ${res.keyIdHex} 2026-09-28 1609459200\n`,
            );
          }
          await writeText(
            context.stderr,
            `gpg: Signature made using EDDSA key ${res.keyIdHex}\ngpg: Good signature from "${res.signerUid}" [ultimate]\n`,
          );
          return { exitCode: 0 };
        }

        await writeText(context.stdout, "gpg (GnuPG) 2.4.5 (safe-bash)\n");
        return { exitCode: 0 };
      } catch (err) {
        context.signal.throwIfAborted();
        const msg = err instanceof Error ? err.message : String(err);
        await writeText(context.stderr, `gpg: ${msg}\n`);
        return { exitCode: 2 };
      }
    },
  };
}

export function createGpgCommands(options: GpgCommandsOptions = {}): readonly CommandDefinition[] {
  return [createGpgCommand(options)];
}

export function gpgCommands(options: GpgCommandsOptions = {}): VirtualShellPlugin {
  const commands = createGpgCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "gpg-commands",
    setup(host) {
      if (!replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}
