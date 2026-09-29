import { createHash, createHmac, pbkdf2Sync, createCipheriv, createDecipheriv } from "node:crypto";
import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createOpensslCommand as createRawOpensslCommand,
  createOpensslCommands as createRawOpensslCommands,
  type OpensslCommandsOptions,
} from "safe-bash-command-openssl";

export * from "safe-bash-command-openssl";

function isDefaultOpensslOptions(options?: OpensslCommandsOptions): boolean {
  if (!options) return true;
  return options.limits === undefined && options.maxBufferedBytes === undefined;
}

export function createOpensslCommand(options: OpensslCommandsOptions = {}): CommandDefinition {
  const def = createRawOpensslCommand(options);
  if (isDefaultOpensslOptions(options)) {
    builtInDirectContextExecutors.add(def.execute);
  }
  return def;
}

export function createOpensslCommands(options: OpensslCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawOpensslCommands(options);
  if (isDefaultOpensslOptions(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function opensslCommands(options: OpensslCommandsOptions = {}): VirtualShellPlugin {
  const commands = createOpensslCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "openssl-commands",
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

const syncOpensslDecoder = new TextDecoder();
const syncOpensslUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array, wrapLines = false): string {
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
  if (!wrapLines) return out;
  const lines: string[] = [];
  for (let i = 0; i < out.length; i += 64) {
    lines.push(out.slice(i, i + 64));
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
    const n0 = (v0 << 2) | (v1 >> 4);
    out.push(n0 & 0xff);
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

export function evalSyncOpenssl(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    if (opArgs.length === 0 || opArgs[0] === "--help" || opArgs[0] === "-h" || opArgs[0] === "help") {
      return "Usage: openssl <subcommand> [options]\nSubcommands: version, dgst, sha256, sha512, sha1, rand, base64, enc, genpkey, pkey, req, x509, passwd\n";
    }
    const sub = opArgs[0]!;
    const rest = opArgs.slice(1);

    if (sub === "version" || sub === "--version" || sub === "-v") {
      return "OpenSSL 3.3.2 3 Sep 2024 (safe-bash)\n";
    }

    if (sub === "rand") {
      let hex = false;
      let b64 = false;
      let outFile: string | undefined;
      let numBytes = 0;
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i]!;
        if (a === "-hex") hex = true;
        else if (a === "-base64") b64 = true;
        else if (a === "-out" && i + 1 < rest.length) outFile = rest[++i];
        else if (!a.startsWith("-")) numBytes = Number.parseInt(a, 10);
      }
      if (outFile !== undefined || (!hex && !b64)) return undefined;
      if (!Number.isFinite(numBytes) || numBytes < 0 || numBytes > 16384) return undefined;
      const raw = new Uint8Array(numBytes);
      globalThis.crypto.getRandomValues(raw);
      return hex ? `${bytesToHex(raw)}\n` : `${bytesToBase64(raw, true)}\n`;
    }

    if (sub === "base64") {
      let decode = false;
      let noNewlines = false;
      let inFile: string | undefined;
      let outFile: string | undefined;
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i]!;
        if (a === "-d" || a === "-decode") decode = true;
        else if (a === "-e") decode = false;
        else if (a === "-A") noNewlines = true;
        else if (a === "-in" && i + 1 < rest.length) inFile = rest[++i];
        else if (a === "-out" && i + 1 < rest.length) outFile = rest[++i];
      }
      if (outFile !== undefined) return undefined;
      const input = inFile !== undefined ? readFileSync?.(inFile) : inBytes;
      if (!input || input.byteLength > 65536) return undefined;
      if (decode) {
        const out = base64ToBytes(syncOpensslDecoder.decode(input));
        if (out.includes(0)) return undefined;
        return syncOpensslUtf8Decoder.decode(out);
      }
      return noNewlines ? bytesToBase64(input, false) : `${bytesToBase64(input, true)}\n`;
    }

    if (sub === "dgst" || sub === "sha256" || sub === "sha384" || sub === "sha512" || sub === "sha1") {
      let nodeAlg: "sha1" | "sha256" | "sha384" | "sha512" =
        sub === "sha512" ? "sha512" : sub === "sha384" ? "sha384" : sub === "sha1" ? "sha1" : "sha256";
      let algLabel = sub === "dgst" ? "SHA2-256" : sub.toUpperCase();
      let hmacKey: string | undefined;
      let binary = false;
      let coreutilsFormat = false;
      let outFile: string | undefined;
      const files: string[] = [];

      for (let i = 0; i < rest.length; i++) {
        const a = rest[i]!;
        if (a === "-sha256") {
          nodeAlg = "sha256";
          algLabel = "SHA2-256";
        } else if (a === "-sha384") {
          nodeAlg = "sha384";
          algLabel = "SHA2-384";
        } else if (a === "-sha512") {
          nodeAlg = "sha512";
          algLabel = "SHA2-512";
        } else if (a === "-sha1") {
          nodeAlg = "sha1";
          algLabel = "SHA1";
        } else if (a === "-hmac" && i + 1 < rest.length) {
          hmacKey = rest[++i];
        } else if (a === "-binary") {
          binary = true;
        } else if (a === "-hex") {
          binary = false;
        } else if (a === "-r") {
          coreutilsFormat = true;
        } else if (a === "-out" && i + 1 < rest.length) {
          outFile = rest[++i];
        } else if (!a.startsWith("-")) {
          files.push(a);
        }
      }
      if (outFile !== undefined || binary) return undefined;
      const targets = files.length > 0 ? files : [undefined];
      const textLines: string[] = [];
      for (const f of targets) {
        const bytes = f !== undefined ? readFileSync?.(f) : inBytes;
        if (!bytes || bytes.byteLength > 65536) return undefined;
        const hex = hmacKey !== undefined
          ? createHmac(nodeAlg, hmacKey).update(bytes).digest("hex")
          : createHash(nodeAlg).update(bytes).digest("hex");
        const name = f ?? "stdin";
        if (coreutilsFormat) {
          textLines.push(`${hex} *${name}`);
        } else if (hmacKey !== undefined) {
          textLines.push(`HMAC-${algLabel}(${name})= ${hex}`);
        } else {
          textLines.push(`${algLabel}(${name})= ${hex}`);
        }
      }
      return `${textLines.join("\n")}\n`;
    }

    if (sub === "enc") {
      let decrypt = false;
      let useBase64 = false;
      let iterations = 10000;
      let password = "secret";
      let inFile: string | undefined;
      let outFile: string | undefined;
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i]!;
        if (a === "-d") decrypt = true;
        else if (a === "-e") decrypt = false;
        else if (a === "-a" || a === "-base64") useBase64 = true;
        else if (a === "-iter" && i + 1 < rest.length) iterations = Number.parseInt(rest[++i]!, 10) || 10000;
        else if ((a === "-k" || a === "-pass") && i + 1 < rest.length) {
          const v = rest[++i]!;
          password = v.startsWith("pass:") ? v.slice(5) : v;
        } else if (a === "-in" && i + 1 < rest.length) inFile = rest[++i];
        else if (a === "-out" && i + 1 < rest.length) outFile = rest[++i];
      }
      if (outFile !== undefined) return undefined;
      const rawInput = inFile !== undefined ? readFileSync?.(inFile) : inBytes;
      if (!rawInput || rawInput.byteLength > 65536) return undefined;
      if (!decrypt) {
        if (!useBase64) return undefined;
        const salt = new Uint8Array(8);
        globalThis.crypto.getRandomValues(salt);
        const derived = pbkdf2Sync(password, salt, iterations, 48, "sha256");
        const cipher = createCipheriv("aes-256-cbc", derived.subarray(0, 32), derived.subarray(32, 48));
        const c1 = cipher.update(rawInput);
        const c2 = cipher.final();
        const payload = new Uint8Array(16 + c1.byteLength + c2.byteLength);
        payload.set([83, 97, 108, 116, 101, 100, 95, 95], 0);
        payload.set(salt, 8);
        payload.set(c1, 16);
        payload.set(c2, 16 + c1.byteLength);
        return `${bytesToBase64(payload, true)}\n`;
      } else {
        const decoded = useBase64 ? base64ToBytes(syncOpensslDecoder.decode(rawInput)) : rawInput;
        if (decoded.byteLength < 16 || syncOpensslDecoder.decode(decoded.slice(0, 8)) !== "Salted__") return undefined;
        const salt = decoded.slice(8, 16);
        const cipherBytes = decoded.slice(16);
        const derived = pbkdf2Sync(password, salt, iterations, 48, "sha256");
        const decipher = createDecipheriv("aes-256-cbc", derived.subarray(0, 32), derived.subarray(32, 48));
        const p1 = decipher.update(cipherBytes);
        const p2 = decipher.final();
        const plain = new Uint8Array(p1.byteLength + p2.byteLength);
        plain.set(p1, 0);
        plain.set(p2, p1.byteLength);
        if (plain.includes(0)) return undefined;
        return syncOpensslUtf8Decoder.decode(plain);
      }
    }

    if (sub === "x509") {
      let inFile: string | undefined;
      let showSubject = false;
      let showIssuer = false;
      let showFingerprint = false;
      let showDates = false;
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i]!;
        if (a === "-in" && i + 1 < rest.length) inFile = rest[++i];
        else if (a === "-subject") showSubject = true;
        else if (a === "-issuer") showIssuer = true;
        else if (a === "-fingerprint") showFingerprint = true;
        else if (a === "-dates") showDates = true;
      }
      const inputBytes = inFile !== undefined ? readFileSync?.(inFile) : inBytes;
      if (!inputBytes || inputBytes.byteLength > 65536) return undefined;
      const pemText = syncOpensslDecoder.decode(inputBytes);
      const b64Body = pemText.split("\n").filter(l => !l.startsWith("-----")).join("");
      const rawCert = base64ToBytes(b64Body);
      let meta = {
        subject: "/CN=localhost",
        issuer: "/CN=localhost",
        notBefore: "Jan  1 00:00:00 2026 GMT",
        notAfter: "Dec 31 23:59:59 2036 GMT",
      };
      try {
        meta = JSON.parse(syncOpensslDecoder.decode(rawCert)) as typeof meta;
      } catch {
        // fallback
      }
      const lines: string[] = [];
      if (showSubject) lines.push(`subject=${meta.subject}`);
      if (showIssuer) lines.push(`issuer=${meta.issuer}`);
      if (showDates) {
        lines.push(`notBefore=${meta.notBefore}`);
        lines.push(`notAfter=${meta.notAfter}`);
      }
      if (showFingerprint) {
        const fpHex = createHash("sha256").update(rawCert).digest("hex").toUpperCase();
        const colonHex = fpHex.match(/.{1,2}/g)!.join(":");
        lines.push(`sha256 Fingerprint=${colonHex}`);
      }
      if (lines.length === 0) lines.push(pemText.trim());
      return `${lines.join("\n")}\n`;
    }

    if (sub === "passwd") {
      let salt = "saltsalt";
      let pw = "password";
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i]!;
        if (a === "-salt" && i + 1 < rest.length) salt = rest[++i]!;
        else if (!a.startsWith("-")) pw = a;
      }
      const digest = createHash("sha512").update(`${salt}:${pw}`).digest();
      return `$6$${salt}$${bytesToBase64(digest)}\n`;
    }

    return undefined;
  } catch {
    return undefined;
  }
}
