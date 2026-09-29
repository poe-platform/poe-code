import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { builtInDirectContextExecutors } from "../internal.js";
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
  const digest = createHash("sha256").update(blob).digest();
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
        const toB64Url = (b: Uint8Array) => bytesToBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        const privKey = createPrivateKey({
          key: { kty: "OKP", crv: "Ed25519", d: toB64Url(parsed.seed), x: toB64Url(parsed.pubKey) },
          format: "jwk",
        });
        const msgHash = createHash("sha512").update(inBytes).digest();
        const toSign: number[] = [];
        for (const b of syncSshEncoder.encode("SSHSIG")) toSign.push(b);
        writeSshString(toSign, syncSshEncoder.encode(namespace));
        writeSshString(toSign, new Uint8Array(0));
        writeSshString(toSign, syncSshEncoder.encode("sha512"));
        writeSshString(toSign, msgHash);
        const rawSig = new Uint8Array(sign(null, new Uint8Array(toSign), privKey));
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
        const msgHash = createHash("sha512").update(inBytes).digest();
        const toVerify: number[] = [];
        for (const b of syncSshEncoder.encode("SSHSIG")) toVerify.push(b);
        writeSshString(toVerify, sigNs);
        writeSshString(toVerify, new Uint8Array(0));
        writeSshString(toVerify, hashAlg);
        writeSshString(toVerify, msgHash);
        const toB64Url = (b: Uint8Array) => bytesToBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        const cryptoPub = createPublicKey({
          key: { kty: "OKP", crv: "Ed25519", x: toB64Url(pubKey) },
          format: "jwk",
        });
        const valid = verify(null, new Uint8Array(toVerify), cryptoPub, rawSig);
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
