import { sha256, sha512 } from "@noble/hashes/sha2.js";
const ED25519_P = 2n ** 255n - 19n;
const ED25519_L = 2n ** 252n + 27742317777372353535851937790883648493n;
const edMod = (a: bigint, m = ED25519_P): bigint => ((a % m) + m) % m;
const edModPow = (b: bigint, e: bigint, m = ED25519_P): bigint => {
  let r = 1n; b = edMod(b, m);
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
};
const edInv = (a: bigint): bigint => edModPow(a, ED25519_P - 2n, ED25519_P);
const ED25519_D = edMod(-121665n * edInv(121666n));
const ED25519_I = edModPow(2n, (ED25519_P - 1n) / 4n);
const ED25519_BY = edMod(4n * edInv(5n));
const ED25519_BX = 15112221349535400772501151409588531511454012693041857206046113283949847762202n;
type EdPt = readonly [bigint, bigint, bigint, bigint];
const ED25519_B: EdPt = [ED25519_BX, ED25519_BY, 1n, edMod(ED25519_BX * ED25519_BY)];

function edPtAdd(p: EdPt, q: EdPt): EdPt {
  const [X1, Y1, Z1, T1] = p, [X2, Y2, Z2, T2] = q;
  const A = edMod((Y1 - X1) * (Y2 - X2)), B_ = edMod((Y1 + X1) * (Y2 + X2));
  const C = edMod(T1 * 2n * ED25519_D * T2), D_ = edMod(Z1 * 2n * Z2);
  const E = edMod(B_ - A), F = edMod(D_ - C), G = edMod(D_ + C), H = edMod(B_ + A);
  return [edMod(E * F), edMod(G * H), edMod(F * G), edMod(E * H)];
}
function edPtMul(p: EdPt, n: bigint): EdPt {
  let r: EdPt = [0n, 1n, 1n, 0n], t = p;
  while (n > 0n) { if (n & 1n) r = edPtAdd(r, t); t = edPtAdd(t, t); n >>= 1n; }
  return r;
}
function edEncodePt(p: EdPt): Uint8Array {
  const z = edInv(p[2]), x = edMod(p[0] * z), y = edMod(p[1] * z);
  const out = new Uint8Array(32);
  let v = y;
  for (let i = 0; i < 32; i++) { out[i] = Number(v & 0xffn); v >>= 8n; }
  out[31]! |= Number(x & 1n) << 7;
  return out;
}
function edDecodePt(b: Uint8Array): EdPt | null {
  let y = 0n;
  for (let i = 0; i < 32; i++) y |= BigInt(b[i]! & (i === 31 ? 0x7f : 0xff)) << BigInt(8 * i);
  if (y >= ED25519_P) return null;
  const sign = (b[31]! >>> 7) & 1;
  const y2 = edMod(y * y), u = edMod(y2 - 1n), v = edMod(ED25519_D * y2 + 1n);
  let x = edMod(u * edModPow(v, 3n) * edModPow(edMod(u * edModPow(v, 7n)), (ED25519_P - 5n) / 8n));
  if (edMod(v * x * x) === edMod(-u)) x = edMod(x * ED25519_I);
  if (edMod(v * x * x) !== u) return null;
  if (x === 0n && sign === 1) return null;
  if (Number(x & 1n) !== sign) x = ED25519_P - x;
  return [x, y, 1n, edMod(x * y)];
}
const edBytesToNumLE = (b: Uint8Array): bigint => { let v = 0n; for (let i = 0; i < b.length; i++) v |= BigInt(b[i]!) << BigInt(8 * i); return v; };
const edNumTo32LE = (v: bigint): Uint8Array => { const o = new Uint8Array(32); for (let i = 0; i < 32; i++) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; };
function ed25519Sign(msg: Uint8Array, seed: Uint8Array): Uint8Array {
  const h = sha512(seed);
  const sBytes = h.slice(0, 32);
  sBytes[0]! &= 248; sBytes[31]! &= 127; sBytes[31]! |= 64;
  const a = edBytesToNumLE(sBytes);
  const A = edEncodePt(edPtMul(ED25519_B, a));
  const rInput = new Uint8Array(32 + msg.length);
  rInput.set(h.slice(32, 64), 0); rInput.set(msg, 32);
  const r = edMod(edBytesToNumLE(sha512(rInput)), ED25519_L);
  const R = edEncodePt(edPtMul(ED25519_B, r));
  const kInput = new Uint8Array(64 + msg.length);
  kInput.set(R, 0); kInput.set(A, 32); kInput.set(msg, 64);
  const k = edMod(edBytesToNumLE(sha512(kInput)), ED25519_L);
  const S = edNumTo32LE(edMod(r + k * a, ED25519_L));
  const sig = new Uint8Array(64);
  sig.set(R, 0); sig.set(S, 32);
  return sig;
}
function ed25519Verify(sig: Uint8Array, msg: Uint8Array, pub: Uint8Array): boolean {
  if (sig.length !== 64 || pub.length !== 32) return false;
  const R = edDecodePt(sig.subarray(0, 32));
  const A = edDecodePt(pub);
  const S = edBytesToNumLE(sig.subarray(32, 64));
  if (!R || !A || S >= ED25519_L) return false;
  const kInput = new Uint8Array(64 + msg.length);
  kInput.set(sig.subarray(0, 32), 0); kInput.set(pub, 32); kInput.set(msg, 64);
  const k = edMod(edBytesToNumLE(sha512(kInput)), ED25519_L);
  const lhs = edEncodePt(edPtMul(ED25519_B, S));
  const rhs = edEncodePt(edPtAdd(R, edPtMul(A, k)));
  return lhs.every((b, i) => b === rhs[i]);
}

import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createGpgCommand as createRawGpgCommand,
  createGpgCommands as createRawGpgCommands,
  type GpgCommandsOptions,
} from "safe-bash-command-gpg";

export * from "safe-bash-command-gpg";

function isDefaultGpgOptions(options?: GpgCommandsOptions): boolean {
  if (!options) return true;
  return options.limits === undefined && options.maxBufferedBytes === undefined;
}

export function createGpgCommand(options: GpgCommandsOptions = {}): CommandDefinition {
  const def = createRawGpgCommand(options);
  if (isDefaultGpgOptions(options)) {
    builtInDirectContextExecutors.add(def.execute);
  }
  return def;
}

export function createGpgCommands(options: GpgCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawGpgCommands(options);
  if (isDefaultGpgOptions(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
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

const syncGpgEncoder = new TextEncoder();
const syncGpgDecoder = new TextDecoder();

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

interface StoredGpgKey {
  uid: string;
  keyIdHex: string;
  seedHex: string;
  pubHex: string;
}

export function evalSyncGpg(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  try {
    if (opArgs.includes("--version")) {
      return "gpg (GnuPG) 2.4.5 (safe-bash)\nlibgcrypt 1.11.0\n";
    }
    let detachSign = false;
    let verify = false;
    let listKeys = false;
    let quickGenKey = false;
    let exportKeys = false;
    let importKeys = false;
    let signerUid = "Git User <user@example.com>";
    let statusFd: string | undefined;
    let outFile: string | undefined;
    const positionals: string[] = [];

    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "--detach-sign" || a === "-b" || a === "-bsau" || a === "-bsa") detachSign = true;
      else if (a === "--verify") verify = true;
      else if (a === "--list-keys" || a === "-k" || a === "--list-secret-keys" || a === "-K") listKeys = true;
      else if (a === "--quick-generate-key" || a === "--quick-gen-key" || a === "--gen-key" || a === "--full-generate-key")
        quickGenKey = true;
      else if (a === "--export") exportKeys = true;
      else if (a === "--import") importKeys = true;
      else if ((a === "-u" || a === "--local-user") && i + 1 < opArgs.length) signerUid = opArgs[++i]!;
      else if (a.startsWith("-bsau") && a.length > 5) {
        detachSign = true;
        signerUid = a.slice(5);
      } else if (a === "--status-fd" && i + 1 < opArgs.length) statusFd = opArgs[++i];
      else if (a.startsWith("--status-fd=")) statusFd = a.slice("--status-fd=".length);
      else if ((a === "-o" || a === "--output") && i + 1 < opArgs.length) outFile = opArgs[++i];
      else if (a.startsWith("-")) continue;
      else positionals.push(a);
    }

    if (quickGenKey || importKeys || verify || statusFd !== undefined || (outFile !== undefined && outFile !== "-" && !writeFileSync)) {
      return undefined;
    }

    const loadKeyringSync = (): StoredGpgKey[] => {
      const raw = readFileSync?.("/home/user/.gnupg/keyring.json");
      if (!raw) return [];
      try {
        return JSON.parse(syncGpgDecoder.decode(raw)) as StoredGpgKey[];
      } catch {
        return [];
      }
    };

    if (listKeys) {
      const keys = loadKeyringSync();
      const lines: string[] = [];
      for (const k of keys) {
        lines.push(`sec   ed25519/${k.keyIdHex} 2026-09-28 [SC]`);
        lines.push(`uid                 [ultimate] ${k.uid}`);
      }
      return lines.length > 0 ? `${lines.join("\n")}\n` : "";
    }

    if (exportKeys) {
      const keys = loadKeyringSync();
      const armor = `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${bytesToBase64(syncGpgEncoder.encode(JSON.stringify(keys)), 64)}\n-----END PGP PUBLIC KEY BLOCK-----\n`;
      if (outFile && outFile !== "-") {
        if (!writeFileSync || !writeFileSync(outFile, syncGpgEncoder.encode(armor))) return undefined;
        return "";
      }
      return armor;
    }

    if (detachSign) {
      const keys = loadKeyringSync();
      const found = keys.find(k => k.uid.includes(signerUid) || k.keyIdHex.endsWith(signerUid.toUpperCase()));
      if (!found) return undefined;
      const payload = positionals[0] !== undefined ? readFileSync?.(positionals[0]) : inBytes;
      if (!payload || payload.byteLength > 65536) return undefined;
      const fromHex = (h: string) => new Uint8Array(h.match(/.{1,2}/g)!.map(b => Number.parseInt(b, 16)));
      const seed = fromHex(found.seedHex);
      const pubKey = fromHex(found.pubHex);
      const fpDigest = sha256(pubKey);
      const keyId = fpDigest.subarray(24, 32);

      const hashedSub: number[] = [];
      hashedSub.push(5, 2, 0x60, 0x00, 0x00, 0x00);
      hashedSub.push(9, 16, ...keyId);
      const uidBytes = syncGpgEncoder.encode(found.uid);
      if (uidBytes.byteLength < 190) {
        hashedSub.push(1 + uidBytes.byteLength, 28, ...uidBytes);
      }
      const pubKeySub = [33, 0x80 | 28, ...pubKey];
      const sigHeader: number[] = [
        4, 0x00, 22, 8,
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
      const digest = sha256(hashTarget);
      const sigBytes = ed25519Sign(digest, seed);
      const body: number[] = [
        ...sigHeader,
        (pubKeySub.length >>> 8) & 0xff,
        pubKeySub.length & 0xff,
        ...pubKeySub,
        digest[0]!,
        digest[1]!,
        0x01, 0x00, ...sigBytes.slice(0, 32),
        0x01, 0x00, ...sigBytes.slice(32, 64),
      ];
      const packet: number[] = [0xc2];
      if (body.length < 192) packet.push(body.length);
      else packet.push(0xff, (body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff);
      packet.push(...body);
      const pktBytes = new Uint8Array(packet);
      const armor = `-----BEGIN PGP SIGNATURE-----\n\n${bytesToBase64(pktBytes, 64)}\n${pgpCrc24(pktBytes)}\n-----END PGP SIGNATURE-----\n`;
      if (outFile && outFile !== "-") {
        if (!writeFileSync || !writeFileSync(outFile, syncGpgEncoder.encode(armor))) return undefined;
        return "";
      }
      return armor;
    }

    return "gpg (GnuPG) 2.4.5 (safe-bash)\n";
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncGpg = evalSyncGpg;
