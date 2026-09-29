import { createHash, createPrivateKey, sign } from "node:crypto";
import { builtInDirectContextExecutors } from "../internal.js";
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

    if (quickGenKey || importKeys || verify || outFile !== undefined || statusFd !== undefined) {
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
      return `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${bytesToBase64(syncGpgEncoder.encode(JSON.stringify(keys)), 64)}\n-----END PGP PUBLIC KEY BLOCK-----\n`;
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
      const fpDigest = createHash("sha256").update(pubKey).digest();
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
      const digest = createHash("sha256").update(hashTarget).digest();
      const toB64Url = (b: Uint8Array) => bytesToBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      const privKey = createPrivateKey({
        key: { kty: "OKP", crv: "Ed25519", d: toB64Url(seed), x: toB64Url(pubKey) },
        format: "jwk",
      });
      const sigBytes = new Uint8Array(sign(null, digest, privKey));
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
      return `-----BEGIN PGP SIGNATURE-----\n\n${bytesToBase64(pktBytes, 64)}\n${pgpCrc24(pktBytes)}\n-----END PGP SIGNATURE-----\n`;
    }

    return "gpg (GnuPG) 2.4.5 (safe-bash)\n";
  } catch {
    return undefined;
  }
}
