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
  createSshCommand as createRawSshCommand,
  createSshKeygenCommand as createRawSshKeygenCommand,
  createSshCommands as createRawSshCommands,
  type SshCommandsOptions,
} from "safe-bash-command-ssh";

export * from "safe-bash-command-ssh";

function isDefaultSshOptions(options?: SshCommandsOptions): boolean {
  if (!options) return true;
  return options.limits === undefined && options.maxBufferedBytes === undefined;
}

export function createSshCommand(options: SshCommandsOptions = {}): CommandDefinition {
  const def = createRawSshCommand(options);
  if (isDefaultSshOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createSshKeygenCommand(options: SshCommandsOptions = {}): CommandDefinition {
  const def = createRawSshKeygenCommand(options);
  if (isDefaultSshOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createSshCommands(options: SshCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawSshCommands(options);
  if (isDefaultSshOptions(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function sshCommands(options: SshCommandsOptions = {}): VirtualShellPlugin {
  const commands = createSshCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "ssh-commands",
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

const syncSshEncoder = new TextEncoder();
const syncSshDecoder = new TextDecoder();

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

function writeSshU32(buf: number[], val: number): void {
  buf.push((val >>> 24) & 0xff, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff);
}

function writeSshString(buf: number[], data: Uint8Array): void {
  writeSshU32(buf, data.byteLength);
  for (let i = 0; i < data.byteLength; i++) buf.push(data[i]!);
}

function readSshU32(bytes: Uint8Array, pos: { offset: number }): number | undefined {
  if (pos.offset + 4 > bytes.byteLength) return undefined;
  const v =
    ((bytes[pos.offset]! << 24) |
      (bytes[pos.offset + 1]! << 16) |
      (bytes[pos.offset + 2]! << 8) |
      bytes[pos.offset + 3]!) >>> 0;
  pos.offset += 4;
  return v;
}

function readSshString(bytes: Uint8Array, pos: { offset: number }): Uint8Array | undefined {
  const len = readSshU32(bytes, pos);
  if (len === undefined || pos.offset + len > bytes.byteLength) return undefined;
  const slice = bytes.slice(pos.offset, pos.offset + len);
  pos.offset += len;
  return slice;
}

function sshEd25519PubkeyBlob(pubKey: Uint8Array): Uint8Array {
  const out: number[] = [];
  writeSshString(out, syncSshEncoder.encode("ssh-ed25519"));
  writeSshString(out, pubKey);
  return new Uint8Array(out);
}

function parseOpenSshEd25519PrivateKey(pem: string): { seed: Uint8Array; pubKey: Uint8Array; comment: string } | undefined {
  const b64 = pem.split("\n").map(l => l.trim()).filter(l => !l.startsWith("-----") && l.length > 0).join("");
  const raw = base64ToBytes(b64);
  if (raw.byteLength < 30 || syncSshDecoder.decode(raw.slice(0, 15)) !== "openssh-key-v1\0") return undefined;
  const pos = { offset: 15 };
  readSshString(raw, pos);
  readSshString(raw, pos);
  readSshString(raw, pos);
  readSshU32(raw, pos);
  readSshString(raw, pos);
  const privBlob = readSshString(raw, pos);
  if (!privBlob) return undefined;
  const ppos = { offset: 8 };
  readSshString(privBlob, ppos);
  const pubKey = readSshString(privBlob, ppos);
  const keypair = readSshString(privBlob, ppos);
  const commentBytes = readSshString(privBlob, ppos);
  if (!pubKey || !keypair || keypair.byteLength < 64) return undefined;
  return {
    seed: keypair.slice(0, 32),
    pubKey: pubKey.slice(0, 32),
    comment: commentBytes ? syncSshDecoder.decode(commentBytes) : "",
  };
}

function parseOpenSshEd25519PublicKey(line: string): { pubKey: Uint8Array; comment: string } | undefined {
  const parts = line.trim().split(/\s+/);
  let idx = parts.findIndex(p => p === "ssh-ed25519");
  if (idx < 0) idx = 0;
  const b64 = parts[idx + 1];
  if (!b64) return undefined;
  const blob = base64ToBytes(b64);
  const pos = { offset: 0 };
  const ktype = readSshString(blob, pos);
  if (!ktype || syncSshDecoder.decode(ktype) !== "ssh-ed25519") return undefined;
  const pk = readSshString(blob, pos);
  if (!pk || pk.byteLength !== 32) return undefined;
  return {
    pubKey: pk,
    comment: parts.slice(idx + 2).join(" "),
  };
}

function computeFingerprintSha256Sync(pubKey: Uint8Array): string {
  const blob = sshEd25519PubkeyBlob(pubKey);
  const digest = sha256(blob);
  return `SHA256:${bytesToBase64(digest).replace(/=+$/g, "")}`;
}

export function evalSyncSsh(opArgs: readonly string[]): string | undefined {
  if (opArgs.includes("-V")) return undefined;
  let dumpConfig = false;
  let port = 22;
  let user = "git";
  let identityFile = "/home/user/.ssh/id_ed25519";
  let destination = "localhost";
  const remoteCmd: string[] = [];

  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (a === "-G") dumpConfig = true;
    else if (a === "-p" && i + 1 < opArgs.length) port = Number.parseInt(opArgs[++i]!, 10) || 22;
    else if (a === "-l" && i + 1 < opArgs.length) user = opArgs[++i]!;
    else if (a === "-i" && i + 1 < opArgs.length) identityFile = opArgs[++i]!;
    else if (a === "-o" && i + 1 < opArgs.length) i++;
    else if (a === "-T" || a === "-v") continue;
    else if (!a.startsWith("-")) {
      if (destination === "localhost") {
        if (a.includes("@")) {
          const [u, h] = a.split("@");
          user = u || user;
          destination = h || destination;
        } else {
          destination = a;
        }
      } else {
        remoteCmd.push(a);
      }
    }
  }

  if (dumpConfig) {
    return `user ${user}\nhostname ${destination}\nport ${port}\nidentityfile ${identityFile}\n`;
  }
  if (remoteCmd.length === 0) return undefined;
  return `ssh:${user}@${destination}:${port} ${remoteCmd.join(" ")}\n`;
}

export function evalSyncSshKeygen(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    let fileArg: string | undefined;
    let derivePub = false;
    let showFingerprint = false;
    let findHost: string | undefined;
    let removeHost: string | undefined;
    let yAction: string | undefined;
    let namespace = "file";
    let signerIdentity: string | undefined;
    let signatureFile: string | undefined;
    const positionalFiles: string[] = [];

    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-f" && i + 1 < opArgs.length) fileArg = opArgs[++i];
      else if (a === "-C" && i + 1 < opArgs.length) i++;
      else if (a === "-N" && i + 1 < opArgs.length) i++;
      else if (a === "-t" && i + 1 < opArgs.length) i++;
      else if (a === "-y") derivePub = true;
      else if (a === "-l") showFingerprint = true;
      else if (a === "-F" && i + 1 < opArgs.length) findHost = opArgs[++i];
      else if (a === "-R" && i + 1 < opArgs.length) removeHost = opArgs[++i];
      else if (a === "-Y" && i + 1 < opArgs.length) yAction = opArgs[++i];
      else if (a === "-n" && i + 1 < opArgs.length) namespace = opArgs[++i]!;
      else if (a === "-I" && i + 1 < opArgs.length) signerIdentity = opArgs[++i];
      else if (a === "-s" && i + 1 < opArgs.length) signatureFile = opArgs[++i];
      else if (a === "-q") continue;
      else if (!a.startsWith("-")) positionalFiles.push(a);
    }

    if (removeHost !== undefined) return undefined;

    if (findHost !== undefined) {
      const khPath = fileArg ?? "/home/user/.ssh/known_hosts";
      const khBytes = readFileSync?.(khPath);
      if (!khBytes) return undefined;
      const matches = syncSshDecoder.decode(khBytes)
        .split("\n")
        .filter(l => l.trim().length > 0 && !l.startsWith("#") && l.split(/\s+/)[0]?.split(",").includes(findHost!));
      if (matches.length === 0) return undefined;
      return `${matches.join("\n")}\n`;
    }

    if (yAction !== undefined) {
      if (yAction === "sign") {
        if (positionalFiles.length > 0) return undefined;
        if (!inBytes || inBytes.byteLength > 65536) return undefined;
        const keyPath = fileArg ?? "/home/user/.ssh/id_ed25519";
        const keyBytes = readFileSync?.(keyPath);
        if (!keyBytes) return undefined;
        const parsed = parseOpenSshEd25519PrivateKey(syncSshDecoder.decode(keyBytes));
        if (!parsed) return undefined;
        const msgHash = sha512(inBytes);
        const toSign: number[] = [];
        for (const b of syncSshEncoder.encode("SSHSIG")) toSign.push(b);
        writeSshString(toSign, syncSshEncoder.encode(namespace));
        writeSshString(toSign, new Uint8Array(0));
        writeSshString(toSign, syncSshEncoder.encode("sha512"));
        writeSshString(toSign, msgHash);
        const rawSig = ed25519Sign(new Uint8Array(toSign), parsed.seed);
        const sigBlob: number[] = [];
        writeSshString(sigBlob, syncSshEncoder.encode("ssh-ed25519"));
        writeSshString(sigBlob, rawSig);
        const outer: number[] = [];
        for (const b of syncSshEncoder.encode("SSHSIG")) outer.push(b);
        writeSshU32(outer, 1);
        writeSshString(outer, sshEd25519PubkeyBlob(parsed.pubKey));
        writeSshString(outer, syncSshEncoder.encode(namespace));
        writeSshString(outer, new Uint8Array(0));
        writeSshString(outer, syncSshEncoder.encode("sha512"));
        writeSshString(outer, new Uint8Array(sigBlob));
        return `-----BEGIN SSH SIGNATURE-----\n${bytesToBase64(new Uint8Array(outer), 70)}\n-----END SSH SIGNATURE-----\n`;
      }

      if (yAction === "verify" || yAction === "check-novalidate" || yAction === "find-principals") {
        const sigPath = signatureFile ?? positionalFiles[0] ?? "";
        const sigBytes = readFileSync?.(sigPath);
        if (!sigBytes) return undefined;
        const b64 = syncSshDecoder.decode(sigBytes).split("\n").map(l => l.trim()).filter(l => !l.startsWith("-----") && l.length > 0).join("");
        const raw = base64ToBytes(b64);
        if (raw.byteLength < 10 || syncSshDecoder.decode(raw.slice(0, 6)) !== "SSHSIG") return undefined;
        const pos = { offset: 10 };
        const pubBlob = readSshString(raw, pos);
        const sigNs = readSshString(raw, pos);
        readSshString(raw, pos);
        const hashAlg = readSshString(raw, pos);
        const sigBlob = readSshString(raw, pos);
        if (!pubBlob || !sigNs || !hashAlg || !sigBlob) return undefined;
        const ppos = { offset: 0 };
        readSshString(pubBlob, ppos);
        const pubKey = readSshString(pubBlob, ppos);
        const spos = { offset: 0 };
        readSshString(sigBlob, spos);
        const rawSig = readSshString(sigBlob, spos);
        if (!pubKey || !rawSig) return undefined;

        if (yAction === "find-principals") {
          if (!fileArg) return undefined;
          const asBytes = readFileSync?.(fileArg);
          if (!asBytes) return undefined;
          const fp = computeFingerprintSha256Sync(pubKey);
          for (const line of syncSshDecoder.decode(asBytes).split("\n")) {
            const p = parseOpenSshEd25519PublicKey(line);
            if (p && computeFingerprintSha256Sync(p.pubKey) === fp) {
              const principal = line.trim().split(/\s+/)[0]!;
              return `${principal}\n`;
            }
          }
          return undefined;
        }

        if (!inBytes || inBytes.byteLength > 65536) return undefined;
        const msgHash = sha512(inBytes);
        const toVerify: number[] = [];
        for (const b of syncSshEncoder.encode("SSHSIG")) toVerify.push(b);
        writeSshString(toVerify, sigNs);
        writeSshString(toVerify, new Uint8Array(0));
        writeSshString(toVerify, hashAlg);
        writeSshString(toVerify, msgHash);
        const valid = ed25519Verify(rawSig, new Uint8Array(toVerify), pubKey);
        if (!valid) return undefined;
        const fp = computeFingerprintSha256Sync(pubKey);
        return `Good "${syncSshDecoder.decode(sigNs)}" signature for ${signerIdentity ?? "principal"} with ED25519 key ${fp}\n`;
      }
      return undefined;
    }

    if (derivePub) {
      const keyPath = fileArg ?? "/home/user/.ssh/id_ed25519";
      const keyBytes = readFileSync?.(keyPath);
      if (!keyBytes) return undefined;
      const parsed = parseOpenSshEd25519PrivateKey(syncSshDecoder.decode(keyBytes));
      if (!parsed) return undefined;
      return `ssh-ed25519 ${bytesToBase64(sshEd25519PubkeyBlob(parsed.pubKey))} ${parsed.comment}\n`;
    }

    if (showFingerprint) {
      const keyPath = fileArg ?? "/home/user/.ssh/id_ed25519.pub";
      const keyBytes = readFileSync?.(keyPath);
      if (!keyBytes) return undefined;
      const content = syncSshDecoder.decode(keyBytes);
      const privParsed = parseOpenSshEd25519PrivateKey(content);
      const pubParsed = privParsed ?? parseOpenSshEd25519PublicKey(content);
      if (!pubParsed) return undefined;
      const fp = computeFingerprintSha256Sync(pubParsed.pubKey);
      return `256 ${fp} ${pubParsed.comment || keyPath} (ED25519)\n`;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncSsh = evalSyncSsh;
syncCommandEvaluators.evalSyncSshKeygen = evalSyncSshKeygen;
