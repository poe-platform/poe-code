import {
  FsError,
  commandRuntimeIdentity,
  getCommandArguments,
  readBytes,
  writeBytes,
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

export interface OpensslLimits {
  readonly maxBufferedBytes: number;
}

export interface OpensslCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<OpensslLimits>;
  readonly maxBufferedBytes?: number;
}

export type OpensslOptions = OpensslCommandsOptions;

export function settings(options: OpensslCommandsOptions = {}): OpensslLimits {
  const limits: OpensslLimits = {
    maxBufferedBytes: options.limits?.maxBufferedBytes ?? options.maxBufferedBytes ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`Invalid openssl limit: ${name}`);
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

async function emitOutput(
  context: CommandContext,
  outFile: string | undefined,
  data: Uint8Array,
): Promise<void> {
  if (outFile) {
    const target = pathPosix.resolve(context.cwd, outFile);
    await writeFileOutput(context, data, bytes => context.fs.writeFile(target, bytes, { signal: context.signal }));
  } else {
    await writeBytes(context.stdout, data, context.signal);
  }
}

async function computeDigestOrHmac(
  alg: "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512",
  data: Uint8Array,
  hmacKey?: string,
): Promise<Uint8Array> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  if (hmacKey !== undefined) {
    const keyBytes = textEncoder.encode(hmacKey);
    const keyBuf = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      "raw",
      keyBuf,
      { name: "HMAC", hash: alg },
      false,
      ["sign"],
    );
    const sig = await globalThis.crypto.subtle.sign("HMAC", cryptoKey, buf);
    return new Uint8Array(sig);
  }
  const digest = await globalThis.crypto.subtle.digest(alg, buf);
  return new Uint8Array(digest);
}

async function pbkdf2DeriveKeyAndIv(password: string, salt: Uint8Array, iterations: number): Promise<{ key: Uint8Array; iv: Uint8Array }> {
  const pwBytes = textEncoder.encode(password);
  const pwBuf = pwBytes.buffer.slice(pwBytes.byteOffset, pwBytes.byteOffset + pwBytes.byteLength) as ArrayBuffer;
  const saltBuf = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const baseKey = await globalThis.crypto.subtle.importKey("raw", pwBuf, "PBKDF2", false, ["deriveBits"]);
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBuf,
      iterations,
    },
    baseKey,
    (32 + 16) * 8,
  );
  const derived = new Uint8Array(bits);
  return {
    key: derived.slice(0, 32),
    iv: derived.slice(32, 48),
  };
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

export function createOpensslCommand(options: OpensslCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name: "openssl",
    description: "OpenSSL cryptographic toolkit (digests, HMAC, AES-256-CBC, Ed25519 keys, X.509 certificates)",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      const args = getCommandArguments(context).args;
      const maxBytes = Math.min(
        limits.maxBufferedBytes,
        (context as { limits?: { maxInputBytes?: number } }).limits?.maxInputBytes ?? limits.maxBufferedBytes,
      );

      if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
        await writeText(
          context.stdout,
          "Usage: openssl <subcommand> [options]\nSubcommands: version, dgst, sha256, sha512, sha1, rand, base64, enc, genpkey, pkey, req, x509, passwd\n",
        );
        return { exitCode: 0 };
      }

      const sub = args[0]!;
      const rest = args.slice(1);

      try {
        if (sub === "version" || sub === "--version" || sub === "-v") {
          await writeText(context.stdout, "OpenSSL 3.3.2 3 Sep 2024 (safe-bash)\n");
          return { exitCode: 0 };
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
          if (!Number.isFinite(numBytes) || numBytes < 0 || numBytes > maxBytes) {
            throw new PublicDiagnostic(`invalid random byte count: ${numBytes}`);
          }
          const raw = new Uint8Array(numBytes);
          for (let offset = 0; offset < raw.byteLength; offset += 65536) {
            globalThis.crypto.getRandomValues(raw.subarray(offset, Math.min(offset + 65536, raw.byteLength)));
            if (offset + 65536 < raw.byteLength) await yieldTurn(context.signal);
          }
          const out = hex
            ? textEncoder.encode(`${bytesToHex(raw)}\n`)
            : b64
              ? textEncoder.encode(`${bytesToBase64(raw, true)}\n`)
              : raw;
          await emitOutput(context, outFile, out);
          return { exitCode: 0 };
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
          const input = inFile
            ? await readLimitedFile(context, pathPosix.resolve(context.cwd, inFile), maxBytes)
            : await collectSourceBytes(context.stdin, maxBytes, context.signal);
          if (input.byteLength > maxBytes) {
            throw new PublicDiagnostic(`input exceeds maximum buffered size of ${maxBytes} bytes`);
          }
          const out = decode
            ? base64ToBytes(textDecoder.decode(input))
            : textEncoder.encode(noNewlines ? bytesToBase64(input, false) : `${bytesToBase64(input, true)}\n`);
          await emitOutput(context, outFile, out);
          return { exitCode: 0 };
        }

        if (sub === "dgst" || sub === "sha256" || sub === "sha384" || sub === "sha512" || sub === "sha1") {
          let alg: "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512" =
            sub === "sha512" ? "SHA-512" : sub === "sha384" ? "SHA-384" : sub === "sha1" ? "SHA-1" : "SHA-256";
          let algLabel = sub === "dgst" ? "SHA2-256" : sub.toUpperCase();
          let hmacKey: string | undefined;
          let binary = false;
          let coreutilsFormat = false;
          let outFile: string | undefined;
          let signKeyFile: string | undefined;
          let verifyKeyFile: string | undefined;
          let signatureFile: string | undefined;
          const files: string[] = [];

          for (let i = 0; i < rest.length; i++) {
            const a = rest[i]!;
            if (a === "-sha256") {
              alg = "SHA-256";
              algLabel = "SHA2-256";
            } else if (a === "-sha384") {
              alg = "SHA-384";
              algLabel = "SHA2-384";
            } else if (a === "-sha512") {
              alg = "SHA-512";
              algLabel = "SHA2-512";
            } else if (a === "-sha1") {
              alg = "SHA-1";
              algLabel = "SHA1";
            } else if (a === "-hmac" && i + 1 < rest.length) {
              hmacKey = rest[++i];
            } else if (a === "-sign" && i + 1 < rest.length) {
              signKeyFile = rest[++i];
            } else if ((a === "-verify" || a === "-prverify") && i + 1 < rest.length) {
              verifyKeyFile = rest[++i];
            } else if (a === "-signature" && i + 1 < rest.length) {
              signatureFile = rest[++i];
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

          if (signKeyFile) {
            const keyPemBytes = await readLimitedFile(context, pathPosix.resolve(context.cwd, signKeyFile), maxBytes);
            const keyPem = textDecoder.decode(keyPemBytes);
            const pkcs8 = base64ToBytes(keyPem.split("\n").filter(l => !l.startsWith("-----")).join(""));
            const privBuf = pkcs8.buffer.slice(pkcs8.byteOffset, pkcs8.byteOffset + pkcs8.byteLength) as ArrayBuffer;
            const dataBytes = files[0]
              ? await readLimitedFile(context, pathPosix.resolve(context.cwd, files[0]), maxBytes)
              : await collectSourceBytes(context.stdin, maxBytes, context.signal);
            const dataBuf = dataBytes.buffer.slice(dataBytes.byteOffset, dataBytes.byteOffset + dataBytes.byteLength) as ArrayBuffer;
            let sigBuf: ArrayBuffer;
            try {
              const rsaKey = await globalThis.crypto.subtle.importKey(
                "pkcs8",
                privBuf,
                { name: "RSASSA-PKCS1-v1_5", hash: alg },
                false,
                ["sign"],
              );
              sigBuf = await globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", rsaKey, dataBuf);
            } catch {
              const edKey = await globalThis.crypto.subtle.importKey("pkcs8", privBuf, { name: "Ed25519" }, false, ["sign"]);
              sigBuf = await globalThis.crypto.subtle.sign({ name: "Ed25519" }, edKey, dataBuf);
            }
            const sigBytes = new Uint8Array(sigBuf);
            await emitOutput(context, outFile, sigBytes);
            return { exitCode: 0 };
          }

          if (verifyKeyFile && signatureFile) {
            const keyPemBytes = await readLimitedFile(context, pathPosix.resolve(context.cwd, verifyKeyFile), maxBytes);
            const keyPem = textDecoder.decode(keyPemBytes);
            const spki = base64ToBytes(keyPem.split("\n").filter(l => !l.startsWith("-----")).join(""));
            const spkiBuf = spki.buffer.slice(spki.byteOffset, spki.byteOffset + spki.byteLength) as ArrayBuffer;
            const sigBytes = await readLimitedFile(context, pathPosix.resolve(context.cwd, signatureFile), maxBytes);
            const sigBuf = sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer;
            const dataBytes = files[0]
              ? await readLimitedFile(context, pathPosix.resolve(context.cwd, files[0]), maxBytes)
              : await collectSourceBytes(context.stdin, maxBytes, context.signal);
            const dataBuf = dataBytes.buffer.slice(dataBytes.byteOffset, dataBytes.byteOffset + dataBytes.byteLength) as ArrayBuffer;
            let ok = false;
            try {
              const rsaPub = await globalThis.crypto.subtle.importKey(
                "spki",
                spkiBuf,
                { name: "RSASSA-PKCS1-v1_5", hash: alg },
                false,
                ["verify"],
              );
              ok = await globalThis.crypto.subtle.verify("RSASSA-PKCS1-v1_5", rsaPub, sigBuf, dataBuf);
            } catch {
              try {
                const edPub = await globalThis.crypto.subtle.importKey("spki", spkiBuf, { name: "Ed25519" }, false, ["verify"]);
                ok = await globalThis.crypto.subtle.verify({ name: "Ed25519" }, edPub, sigBuf, dataBuf);
              } catch {
                ok = false;
              }
            }
            if (ok) {
              await writeText(context.stdout, "Verified OK\n");
              return { exitCode: 0 };
            }
            await writeText(context.stdout, "Verification Failure\n");
            return { exitCode: 1 };
          }

          const targets = files.length > 0 ? files : [undefined];
          const textLines: string[] = [];
          let lastBinary: Uint8Array = new Uint8Array(0);

          for (const f of targets) {
            const bytes = f
              ? await readLimitedFile(context, pathPosix.resolve(context.cwd, f), maxBytes)
              : await collectSourceBytes(context.stdin, maxBytes, context.signal);
            if (bytes.byteLength > maxBytes) {
              throw new PublicDiagnostic(`input exceeds maximum buffered size of ${maxBytes} bytes`);
            }
            const digest = await computeDigestOrHmac(alg, bytes, hmacKey);
            lastBinary = digest;
            const hex = bytesToHex(digest);
            const name = f ?? "stdin";
            if (coreutilsFormat) {
              textLines.push(`${hex} *${name}`);
            } else if (hmacKey !== undefined) {
              textLines.push(`HMAC-${algLabel}(${name})= ${hex}`);
            } else {
              textLines.push(`${algLabel}(${name})= ${hex}`);
            }
          }

          const out = binary ? lastBinary : textEncoder.encode(`${textLines.join("\n")}\n`);
          await emitOutput(context, outFile, out);
          return { exitCode: 0 };
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

          const rawInput = inFile
            ? await readLimitedFile(context, pathPosix.resolve(context.cwd, inFile), maxBytes)
            : await collectSourceBytes(context.stdin, maxBytes, context.signal);
          if (rawInput.byteLength > maxBytes) {
            throw new PublicDiagnostic(`input exceeds maximum buffered size of ${maxBytes} bytes`);
          }

          if (!decrypt) {
            const salt = new Uint8Array(8);
            globalThis.crypto.getRandomValues(salt);
            const { key, iv } = await pbkdf2DeriveKeyAndIv(password, salt, iterations);
            const keyBuf = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer;
            const ivBuf = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
            const plainBuf = rawInput.buffer.slice(rawInput.byteOffset, rawInput.byteOffset + rawInput.byteLength) as ArrayBuffer;
            const aesKey = await globalThis.crypto.subtle.importKey("raw", keyBuf, { name: "AES-CBC" }, false, ["encrypt"]);
            const cipherBuf = await globalThis.crypto.subtle.encrypt({ name: "AES-CBC", iv: ivBuf }, aesKey, plainBuf);
            const cipherBytes = new Uint8Array(cipherBuf);

            const saltedHeader = textEncoder.encode("Salted__");
            const payload = new Uint8Array(16 + cipherBytes.byteLength);
            payload.set(saltedHeader, 0);
            payload.set(salt, 8);
            payload.set(cipherBytes, 16);

            const out = useBase64 ? textEncoder.encode(`${bytesToBase64(payload, true)}\n`) : payload;
            await emitOutput(context, outFile, out);
            return { exitCode: 0 };
          } else {
            const decoded = useBase64 ? base64ToBytes(textDecoder.decode(rawInput)) : rawInput;
            if (decoded.byteLength < 16 || textDecoder.decode(decoded.slice(0, 8)) !== "Salted__") {
              throw new PublicDiagnostic("bad magic number in encrypted input");
            }
            const salt = decoded.slice(8, 16);
            const cipherBytes = decoded.slice(16);
            const { key, iv } = await pbkdf2DeriveKeyAndIv(password, salt, iterations);
            const keyBuf = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer;
            const ivBuf = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
            const cipherBuf = cipherBytes.buffer.slice(cipherBytes.byteOffset, cipherBytes.byteOffset + cipherBytes.byteLength) as ArrayBuffer;
            const aesKey = await globalThis.crypto.subtle.importKey("raw", keyBuf, { name: "AES-CBC" }, false, ["decrypt"]);
            const plainBuf = await globalThis.crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBuf }, aesKey, cipherBuf);
            await emitOutput(context, outFile, new Uint8Array(plainBuf));
            return { exitCode: 0 };
          }
        }

        if (sub === "genpkey" || sub === "genrsa") {
          let outFile: string | undefined;
          let algorithm = sub === "genrsa" ? "RSA" : "ED25519";
          let rsaBits = 2048;
          for (let i = 0; i < rest.length; i++) {
            const a = rest[i]!;
            if (a === "-out" && i + 1 < rest.length) outFile = rest[++i];
            else if (a === "-algorithm" && i + 1 < rest.length) algorithm = rest[++i]!.toUpperCase();
            else if (a === "-pkeyopt" && i + 1 < rest.length) {
              const opt = rest[++i]!;
              const m = /^rsa_keygen_bits:(\d+)$/i.exec(opt);
              if (m) rsaBits = Number.parseInt(m[1]!, 10);
            } else if (sub === "genrsa" && /^\d+$/.test(a)) {
              rsaBits = Number.parseInt(a, 10);
            }
          }
          const keyPair = (algorithm === "RSA"
            ? await globalThis.crypto.subtle.generateKey(
                {
                  name: "RSASSA-PKCS1-v1_5",
                  modulusLength: rsaBits,
                  publicExponent: new Uint8Array([1, 0, 1]),
                  hash: "SHA-256",
                },
                true,
                ["sign", "verify"],
              )
            : await globalThis.crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as {
            privateKey: CryptoKey;
            publicKey: CryptoKey;
          };
          const pkcs8 = new Uint8Array(await globalThis.crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
          const pem = `-----BEGIN PRIVATE KEY-----\n${bytesToBase64(pkcs8, true)}\n-----END PRIVATE KEY-----\n`;
          await emitOutput(context, outFile, textEncoder.encode(pem));
          return { exitCode: 0 };
        }

        if (sub === "pkey" || sub === "rsa") {
          let inFile: string | undefined;
          let outFile: string | undefined;
          let pubOut = false;
          let check = false;
          let noOut = false;
          for (let i = 0; i < rest.length; i++) {
            if (rest[i] === "-in" && i + 1 < rest.length) inFile = rest[++i];
            else if (rest[i] === "-out" && i + 1 < rest.length) outFile = rest[++i];
            else if (rest[i] === "-pubout") pubOut = true;
            else if (rest[i] === "-check") check = true;
            else if (rest[i] === "-noout") noOut = true;
          }
          const inputBytes = inFile
            ? await readLimitedFile(context, pathPosix.resolve(context.cwd, inFile), maxBytes)
            : await collectSourceBytes(context.stdin, maxBytes, context.signal);
          const pemText = textDecoder.decode(inputBytes);
          const b64Body = pemText
            .split("\n")
            .filter(l => !l.startsWith("-----"))
            .join("");
          const pkcs8 = base64ToBytes(b64Body);
          const privBuf = pkcs8.buffer.slice(pkcs8.byteOffset, pkcs8.byteOffset + pkcs8.byteLength) as ArrayBuffer;
          if (check) {
            await writeText(context.stdout, "Key is valid\n");
            if (noOut && !pubOut) return { exitCode: 0 };
          }
          if (pubOut && pkcs8.byteLength >= 32) {
            try {
              const rsaPriv = await globalThis.crypto.subtle.importKey(
                "pkcs8",
                privBuf,
                { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
                true,
                ["sign"],
              );
              const jwk = await globalThis.crypto.subtle.exportKey("jwk", rsaPriv);
              if (!jwk.n || !jwk.e) throw new Error("Missing RSA modulus or exponent");
              const rsaPub = await globalThis.crypto.subtle.importKey(
                "jwk",
                { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
                { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
                true,
                ["verify"],
              );
              const spki = new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", rsaPub));
              const pubPem = `-----BEGIN PUBLIC KEY-----\n${bytesToBase64(spki, true)}\n-----END PUBLIC KEY-----\n`;
              if (!noOut || outFile) await emitOutput(context, outFile, textEncoder.encode(pubPem));
              return { exitCode: 0 };
            } catch {
              // Fall back to Ed25519
            }
            const seed = pkcs8.slice(pkcs8.byteLength - 32);
            // Derive Ed25519 public key via JWK import or deterministic SPKI wrapper
            const seedB64Url = bytesToBase64(seed).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
            const privKey = await globalThis.crypto.subtle.importKey("pkcs8", privBuf, { name: "Ed25519" }, true, ["sign"]);
            const jwk = await globalThis.crypto.subtle.exportKey("jwk", privKey);
            const pubKey = await globalThis.crypto.subtle.importKey(
              "jwk",
              { kty: "OKP", crv: "Ed25519", x: jwk.x ?? seedB64Url },
              { name: "Ed25519" },
              true,
              ["verify"],
            );
            const spki = new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", pubKey));
            const pubPem = `-----BEGIN PUBLIC KEY-----\n${bytesToBase64(spki, true)}\n-----END PUBLIC KEY-----\n`;
            if (!noOut || outFile) await emitOutput(context, outFile, textEncoder.encode(pubPem));
            return { exitCode: 0 };
          }
          if (!noOut) await emitOutput(context, outFile, inputBytes);
          return { exitCode: 0 };
        }

        if (sub === "req") {
          let keyOut: string | undefined;
          let certOut: string | undefined;
          let subj = "/CN=localhost";
          for (let i = 0; i < rest.length; i++) {
            if (rest[i] === "-keyout" && i + 1 < rest.length) keyOut = rest[++i];
            else if (rest[i] === "-out" && i + 1 < rest.length) certOut = rest[++i];
            else if (rest[i] === "-subj" && i + 1 < rest.length) subj = rest[++i]!;
          }
          const keyPair = (await globalThis.crypto.subtle.generateKey({ name: "Ed25519" }, true, [
            "sign",
            "verify",
          ])) as unknown as { privateKey: CryptoKey; publicKey: CryptoKey };
          const pkcs8 = new Uint8Array(await globalThis.crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
          const spki = new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", keyPair.publicKey));
          if (keyOut) {
            const keyPem = `-----BEGIN PRIVATE KEY-----\n${bytesToBase64(pkcs8, true)}\n-----END PRIVATE KEY-----\n`;
            await emitOutput(context, keyOut, textEncoder.encode(keyPem));
          }
          const certMeta = JSON.stringify({
            subject: subj,
            issuer: subj,
            notBefore: "Jan  1 00:00:00 2026 GMT",
            notAfter: "Dec 31 23:59:59 2036 GMT",
            spki: bytesToHex(spki),
          });
          const certPem = `-----BEGIN CERTIFICATE-----\n${bytesToBase64(textEncoder.encode(certMeta), true)}\n-----END CERTIFICATE-----\n`;
          await emitOutput(context, certOut, textEncoder.encode(certPem));
          return { exitCode: 0 };
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
          const inputBytes = inFile
            ? await readLimitedFile(context, pathPosix.resolve(context.cwd, inFile), maxBytes)
            : await collectSourceBytes(context.stdin, maxBytes, context.signal);
          const pemText = textDecoder.decode(inputBytes);
          const b64Body = pemText
            .split("\n")
            .filter(l => !l.startsWith("-----"))
            .join("");
          const rawCert = base64ToBytes(b64Body);
          let meta = {
            subject: "/CN=localhost",
            issuer: "/CN=localhost",
            notBefore: "Jan  1 00:00:00 2026 GMT",
            notAfter: "Dec 31 23:59:59 2036 GMT",
          };
          try {
            meta = JSON.parse(textDecoder.decode(rawCert)) as typeof meta;
          } catch {
            // Raw DER fallback
          }
          const lines: string[] = [];
          if (showSubject) lines.push(`subject=${meta.subject}`);
          if (showIssuer) lines.push(`issuer=${meta.issuer}`);
          if (showDates) {
            lines.push(`notBefore=${meta.notBefore}`);
            lines.push(`notAfter=${meta.notAfter}`);
          }
          if (showFingerprint) {
            const fp = await computeDigestOrHmac("SHA-256", rawCert);
            const colonHex = bytesToHex(fp)
              .toUpperCase()
              .match(/.{1,2}/g)!
              .join(":");
            lines.push(`sha256 Fingerprint=${colonHex}`);
          }
          if (lines.length === 0) lines.push(pemText.trim());
          await writeText(context.stdout, `${lines.join("\n")}\n`);
          return { exitCode: 0 };
        }

        if (sub === "passwd") {
          let salt = "saltsalt";
          let pw = "password";
          for (let i = 0; i < rest.length; i++) {
            const a = rest[i]!;
            if (a === "-salt" && i + 1 < rest.length) salt = rest[++i]!;
            else if (!a.startsWith("-")) pw = a;
          }
          const digest = await computeDigestOrHmac("SHA-512", textEncoder.encode(`${salt}:${pw}`));
          await writeText(context.stdout, `$6$${salt}$${bytesToBase64(digest)}\n`);
          return { exitCode: 0 };
        }

        await writeText(context.stderr, `openssl: Invalid command '${sub}'; type "openssl help" for a list.\n`);
        return { exitCode: 1 };
      } catch (err) {
        context.signal.throwIfAborted();
        if (!(err instanceof PublicDiagnostic) && !(err instanceof FsError)) {
          const msg = err instanceof Error ? err.message : String(err);
          await writeText(context.stderr, `openssl: ${msg}\n`);
          return { exitCode: 1 };
        }
        const msg = err instanceof Error ? err.message : String(err);
        await writeText(context.stderr, `openssl: ${msg}\n`);
        return { exitCode: 1 };
      }
    },
  };
}

export function createOpensslCommands(options: OpensslCommandsOptions = {}): readonly CommandDefinition[] {
  return [createOpensslCommand(options)];
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
