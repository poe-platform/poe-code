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

export interface SshLimits {
  readonly maxBufferedBytes: number;
}

export interface SshCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<SshLimits>;
  readonly maxBufferedBytes?: number;
}

export type SshOptions = SshCommandsOptions;

export function settings(options: SshCommandsOptions = {}): SshLimits {
  const limits: SshLimits = {
    maxBufferedBytes: options.limits?.maxBufferedBytes ?? options.maxBufferedBytes ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`Invalid ssh limit: ${name}`);
    }
  }
  return Object.freeze(limits);
}

const pathPosix = {
  resolve(cwd: string, target: string): string {
    const expanded = target.startsWith("~/") ? `/home/user/${target.slice(2)}` : target;
    const raw = expanded.startsWith("/") ? expanded : cwd.endsWith("/") ? cwd + expanded : `${cwd}/${expanded}`;
    const parts = raw.split("/");
    const stack: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return `/${stack.join("/")}`;
  },
  dirname(p: string): string {
    const idx = p.lastIndexOf("/");
    if (idx <= 0) return "/";
    return p.slice(0, idx);
  },
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

function writeSshString(buf: number[], data: Uint8Array): void {
  const len = data.byteLength >>> 0;
  buf.push((len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff);
  for (let i = 0; i < data.byteLength; i++) buf.push(data[i]!);
}

function writeSshU32(buf: number[], v: number): void {
  const u = v >>> 0;
  buf.push((u >>> 24) & 0xff, (u >>> 16) & 0xff, (u >>> 8) & 0xff, u & 0xff);
}

function readSshString(data: Uint8Array, pos: { offset: number }): Uint8Array | undefined {
  if (pos.offset + 4 > data.byteLength) return undefined;
  const len =
    ((data[pos.offset]! << 24) |
      (data[pos.offset + 1]! << 16) |
      (data[pos.offset + 2]! << 8) |
      data[pos.offset + 3]!) >>>
    0;
  pos.offset += 4;
  if (pos.offset + len > data.byteLength) return undefined;
  const slice = data.slice(pos.offset, pos.offset + len);
  pos.offset += len;
  return slice;
}

function sshEd25519PubkeyBlob(pubKey: Uint8Array): Uint8Array {
  const out: number[] = [];
  writeSshString(out, textEncoder.encode("ssh-ed25519"));
  writeSshString(out, pubKey);
  return new Uint8Array(out);
}

function formatOpenSshEd25519PrivateKey(seed: Uint8Array, pubKey: Uint8Array, comment: string): string {
  const pubBlob = sshEd25519PubkeyBlob(pubKey);
  const out: number[] = [];
  for (const b of textEncoder.encode("openssh-key-v1\0")) out.push(b);
  writeSshString(out, textEncoder.encode("none"));
  writeSshString(out, textEncoder.encode("none"));
  writeSshString(out, new Uint8Array(0));
  writeSshU32(out, 1);
  writeSshString(out, pubBlob);

  const privSection: number[] = [];
  const check = 0xa1b2c3d4;
  writeSshU32(privSection, check);
  writeSshU32(privSection, check);
  writeSshString(privSection, textEncoder.encode("ssh-ed25519"));
  writeSshString(privSection, pubKey);
  const keypair = new Uint8Array(64);
  keypair.set(seed, 0);
  keypair.set(pubKey, 32);
  writeSshString(privSection, keypair);
  writeSshString(privSection, textEncoder.encode(comment));
  let pad = 1;
  while (privSection.length % 8 !== 0) {
    privSection.push(pad & 0xff);
    pad++;
  }
  writeSshString(out, new Uint8Array(privSection));
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${bytesToBase64(new Uint8Array(out), 70)}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

function parseOpenSshEd25519PrivateKey(pem: string): { seed: Uint8Array; pubKey: Uint8Array; comment: string } | undefined {
  const b64 = pem
    .split("\n")
    .map(l => l.trim())
    .filter(l => !l.startsWith("-----") && l.length > 0)
    .join("");
  const raw = base64ToBytes(b64);
  const magic = "openssh-key-v1\0";
  if (raw.byteLength < magic.length || textDecoder.decode(raw.slice(0, magic.length)) !== magic) {
    return undefined;
  }
  const pos = { offset: magic.length };
  readSshString(raw, pos); // ciphername
  readSshString(raw, pos); // kdfname
  readSshString(raw, pos); // kdfoptions
  pos.offset += 4; // nkeys
  readSshString(raw, pos); // pub_blob
  const privBlob = readSshString(raw, pos);
  if (!privBlob || privBlob.byteLength < 8) return undefined;
  const ppos = { offset: 8 }; // check1, check2
  const ktype = readSshString(privBlob, ppos);
  if (!ktype || textDecoder.decode(ktype) !== "ssh-ed25519") return undefined;
  const pubKey = readSshString(privBlob, ppos);
  const keypair = readSshString(privBlob, ppos);
  const commentBytes = readSshString(privBlob, ppos);
  if (!pubKey || !keypair || keypair.byteLength < 64) return undefined;
  return {
    seed: keypair.slice(0, 32),
    pubKey: pubKey.slice(0, 32),
    comment: commentBytes ? textDecoder.decode(commentBytes) : "",
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
  if (!ktype || textDecoder.decode(ktype) !== "ssh-ed25519") return undefined;
  const pk = readSshString(blob, pos);
  if (!pk || pk.byteLength !== 32) return undefined;
  return {
    pubKey: pk,
    comment: parts.slice(idx + 2).join(" "),
  };
}

function matchesGlob(value: string, pattern: string): boolean {
  let v = 0;
  let p = 0;
  let star = -1;
  let retry = 0;
  while (v < value.length) {
    if (pattern[p] === "?" || pattern[p] === value[v]) { v++; p++; }
    else if (pattern[p] === "*") { star = p++; retry = v; }
    else if (star >= 0) { p = star + 1; v = ++retry; }
    else return false;
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}

function matchesPatterns(value: string, patterns: string): boolean {
  let matched = false;
  for (const pattern of patterns.split(",")) {
    const negative = pattern.startsWith("!");
    if (matchesGlob(value, negative ? pattern.slice(1) : pattern)) {
      if (negative) return false;
      matched = true;
    }
  }
  return matched;
}

function parseAllowedSigner(line: string): { principals: string; namespaces?: string; pubKey: Uint8Array } | undefined {
  const text = line.trim();
  if (!text || text.startsWith("#")) return undefined;
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === " " || char === "\t")) {
      if (field) { fields.push(field); field = ""; }
    } else field += char;
  }
  if (quoted) return undefined;
  if (field) fields.push(field);
  const principals = fields[0];
  let index = 1;
  let namespaces: string | undefined;
  if (fields[index] !== "ssh-ed25519") {
    const options = fields[index++];
    // Fail closed for certificate and validity options that this implementation cannot enforce.
    if (!options?.startsWith('namespaces="') || !options.endsWith('"')) return undefined;
    namespaces = options.slice(12, -1);
    if (!namespaces || namespaces.includes('"')) return undefined;
  }
  if (!principals || fields[index] !== "ssh-ed25519" || !fields[index + 1]) return undefined;
  const key = parseOpenSshEd25519PublicKey(`${fields[index]} ${fields[index + 1]}`);
  return key ? { principals, ...(namespaces === undefined ? {} : { namespaces }), pubKey: key.pubKey } : undefined;
}

async function computeFingerprintSha256(pubKey: Uint8Array): Promise<string> {
  const blob = sshEd25519PubkeyBlob(pubKey);
  const buf = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", buf));
  return `SHA256:${bytesToBase64(digest).replace(/=+$/g, "")}`;
}

async function importEd25519FromSeedAndPub(seed: Uint8Array, pubKey: Uint8Array): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  const toB64Url = (b: Uint8Array) => bytesToBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const d = toB64Url(seed);
  const x = toB64Url(pubKey);
  const privateKey = await globalThis.crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", d, x, key_ops: ["sign"] },
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const publicKey = await globalThis.crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", x, key_ops: ["verify"] },
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return { privateKey, publicKey };
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

export function createSshKeygenCommand(options: SshCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name: "ssh-keygen",
    description: "OpenSSH authentication key and SSHSIG signature utility",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      const args = getCommandArguments(context).args;
      const maxBytes = Math.min(
        limits.maxBufferedBytes,
        (context as { limits?: { maxInputBytes?: number } }).limits?.maxInputBytes ?? limits.maxBufferedBytes,
      );

      let fileArg: string | undefined;
      let comment = "user@safe-bash";
      let derivePub = false;
      let showFingerprint = false;
      let findHost: string | undefined;
      let removeHost: string | undefined;
      let yAction: string | undefined;
      let namespace = "file";
      let namespaceProvided = false;
      let allowedSignersFile: string | undefined;
      let signerIdentity: string | undefined;
      let signatureFile: string | undefined;
      const positionalFiles: string[] = [];

      for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if (a === "-f" && i + 1 < args.length) fileArg = args[++i];
        else if (a === "-C" && i + 1 < args.length) comment = args[++i]!;
        else if (a === "-N" && i + 1 < args.length) i++;
        else if (a === "-t" && i + 1 < args.length) i++;
        else if (a === "-y") derivePub = true;
        else if (a === "-l") showFingerprint = true;
        else if (a === "-F" && i + 1 < args.length) findHost = args[++i];
        else if (a === "-R" && i + 1 < args.length) removeHost = args[++i];
        else if (a === "-Y" && i + 1 < args.length) yAction = args[++i];
        else if (a === "-n" && i + 1 < args.length) { namespace = args[++i]!; namespaceProvided = true; }
        else if (a === "-I" && i + 1 < args.length) signerIdentity = args[++i];
        else if (a === "-s" && i + 1 < args.length) signatureFile = args[++i];
        else if (a === "-q") continue;
        else if (!a.startsWith("-")) positionalFiles.push(a);
      }

      try {
        if (findHost !== undefined) {
          const khPath = pathPosix.resolve(context.cwd, fileArg ?? "/home/user/.ssh/known_hosts");
          const khText = textDecoder.decode(await readLimitedFile(context, khPath, maxBytes).catch(error => {
            if (error instanceof FsError && error.code === "ENOENT") return new Uint8Array(0);
            throw error;
          }));
          const matches = khText
            .split("\n")
            .filter(l => l.trim().length > 0 && !l.startsWith("#") && l.split(/\s+/)[0]?.split(",").includes(findHost!));
          if (matches.length === 0) return { exitCode: 1 };
          await writeText(context.stdout, `${matches.join("\n")}\n`);
          return { exitCode: 0 };
        }

        if (removeHost !== undefined) {
          const khPath = pathPosix.resolve(context.cwd, fileArg ?? "/home/user/.ssh/known_hosts");
          const khText = textDecoder.decode(await readLimitedFile(context, khPath, maxBytes).catch(error => {
            if (error instanceof FsError && error.code === "ENOENT") return new Uint8Array(0);
            throw error;
          }));
          const remaining = khText
            .split("\n")
            .filter(l => l.trim().length === 0 || l.startsWith("#") || !l.split(/\s+/)[0]?.split(",").includes(removeHost!));
          const outBytes = textEncoder.encode(`${remaining.join("\n")}\n`);
          await writeFileOutput(context, outBytes, data => context.fs.writeFile(khPath, data, { signal: context.signal }));
          await writeText(context.stdout, `# Host ${removeHost} found: removed\n${khPath} updated.\n`);
          return { exitCode: 0 };
        }

        if (yAction !== undefined) {
          if (yAction === "sign") {
            const keyPath = pathPosix.resolve(context.cwd, fileArg ?? "/home/user/.ssh/id_ed25519");
            const keyPem = textDecoder.decode(await readLimitedFile(context, keyPath, maxBytes));
            const parsed = parseOpenSshEd25519PrivateKey(keyPem);
            if (!parsed) throw new PublicDiagnostic(`invalid OpenSSH Ed25519 key: ${keyPath}`);
            const { privateKey } = await importEd25519FromSeedAndPub(parsed.seed, parsed.pubKey);

            const targetFile = positionalFiles[0];
            const payload = targetFile
              ? await readLimitedFile(context, pathPosix.resolve(context.cwd, targetFile), maxBytes)
              : await collectSourceBytes(context.stdin, maxBytes, context.signal);
            const payloadBuf = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
            const msgHash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-512", payloadBuf));

            const toSign: number[] = [];
            for (const b of textEncoder.encode("SSHSIG")) toSign.push(b);
            writeSshString(toSign, textEncoder.encode(namespace));
            writeSshString(toSign, new Uint8Array(0));
            writeSshString(toSign, textEncoder.encode("sha512"));
            writeSshString(toSign, msgHash);
            const toSignBytes = new Uint8Array(toSign);
            const toSignBuf = toSignBytes.buffer.slice(toSignBytes.byteOffset, toSignBytes.byteOffset + toSignBytes.byteLength) as ArrayBuffer;
            const rawSig = new Uint8Array(await globalThis.crypto.subtle.sign({ name: "Ed25519" }, privateKey, toSignBuf));

            const sigBlob: number[] = [];
            writeSshString(sigBlob, textEncoder.encode("ssh-ed25519"));
            writeSshString(sigBlob, rawSig);

            const outer: number[] = [];
            for (const b of textEncoder.encode("SSHSIG")) outer.push(b);
            writeSshU32(outer, 1);
            writeSshString(outer, sshEd25519PubkeyBlob(parsed.pubKey));
            writeSshString(outer, textEncoder.encode(namespace));
            writeSshString(outer, new Uint8Array(0));
            writeSshString(outer, textEncoder.encode("sha512"));
            writeSshString(outer, new Uint8Array(sigBlob));

            const armor = `-----BEGIN SSH SIGNATURE-----\n${bytesToBase64(new Uint8Array(outer), 70)}\n-----END SSH SIGNATURE-----\n`;
            if (targetFile) {
              const sigOutPath = `${pathPosix.resolve(context.cwd, targetFile)}.sig`;
              await writeFileOutput(context, textEncoder.encode(armor), data =>
                context.fs.writeFile(sigOutPath, data, { signal: context.signal }),
              );
              await writeText(context.stdout, `Signing file ${targetFile}\nWrite signature to ${targetFile}.sig\n`);
            } else {
              await writeText(context.stdout, armor);
            }
            return { exitCode: 0 };
          }

          if (yAction === "verify" || yAction === "check-novalidate" || yAction === "find-principals") {
            const sigPath = pathPosix.resolve(context.cwd, signatureFile ?? positionalFiles[0] ?? "");
            const sigPem = textDecoder.decode(await readLimitedFile(context, sigPath, maxBytes));
            const b64 = sigPem
              .split("\n")
              .map(l => l.trim())
              .filter(l => !l.startsWith("-----") && l.length > 0)
              .join("");
            const raw = base64ToBytes(b64);
            if (raw.byteLength < 10 || textDecoder.decode(raw.slice(0, 6)) !== "SSHSIG") {
              throw new PublicDiagnostic("invalid SSHSIG header");
            }
            const pos = { offset: 10 };
            const pubBlob = readSshString(raw, pos);
            const sigNs = readSshString(raw, pos);
            readSshString(raw, pos); // reserved
            const hashAlg = readSshString(raw, pos);
            const sigBlob = readSshString(raw, pos);
            if (!pubBlob || !sigNs || !hashAlg || !sigBlob) {
              throw new PublicDiagnostic("truncated SSHSIG structure");
            }
            const ppos = { offset: 0 };
            readSshString(pubBlob, ppos);
            const pubKey = readSshString(pubBlob, ppos);
            const spos = { offset: 0 };
            readSshString(sigBlob, spos);
            const rawSig = readSshString(sigBlob, spos);
            if (!pubKey || !rawSig) throw new PublicDiagnostic("invalid SSHSIG key/signature");

            if (yAction !== "find-principals" && (!namespaceProvided || textDecoder.decode(sigNs) !== namespace)) {
              throw new PublicDiagnostic("signature namespace does not match requested namespace");
            }
            if (yAction === "verify" || yAction === "find-principals") {
              allowedSignersFile = fileArg;
              if (!allowedSignersFile || (yAction === "verify" && !signerIdentity)) {
                throw new PublicDiagnostic("allowed signers file and signer identity are required for verification");
              }
              const asText = textDecoder.decode(await readLimitedFile(context, pathPosix.resolve(context.cwd, allowedSignersFile), maxBytes));
              const entries = asText.split("\n").map(parseAllowedSigner).filter(entry => entry !== undefined);
              const matching = entries.filter(entry => entry.pubKey.every((byte, index) => byte === pubKey[index])
                && (yAction === "find-principals" || matchesPatterns(namespace, entry.namespaces ?? "*")));
              if (yAction === "find-principals") {
                if (matching.length === 0) return { exitCode: 1 };
                await writeText(context.stdout, `${matching.map(entry => entry.principals).join("\n")}\n`);
                return { exitCode: 0 };
              }
              if (!matching.some(entry => matchesPatterns(signerIdentity!, entry.principals))) {
                throw new PublicDiagnostic("signer is not authorized by allowed signers");
              }
            }

            const payload = await collectSourceBytes(context.stdin, maxBytes, context.signal);
            const payloadBuf = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
            const msgHash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-512", payloadBuf));
            const toVerify: number[] = [];
            for (const b of textEncoder.encode("SSHSIG")) toVerify.push(b);
            writeSshString(toVerify, sigNs);
            writeSshString(toVerify, new Uint8Array(0));
            writeSshString(toVerify, hashAlg);
            writeSshString(toVerify, msgHash);
            const toVerifyBytes = new Uint8Array(toVerify);
            const toVerifyBuf = toVerifyBytes.buffer.slice(toVerifyBytes.byteOffset, toVerifyBytes.byteOffset + toVerifyBytes.byteLength) as ArrayBuffer;
            const rawSigBuf = rawSig.buffer.slice(rawSig.byteOffset, rawSig.byteOffset + rawSig.byteLength) as ArrayBuffer;

            const toB64Url = (b: Uint8Array) => bytesToBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
            const cryptoPub = await globalThis.crypto.subtle.importKey(
              "jwk",
              { kty: "OKP", crv: "Ed25519", x: toB64Url(pubKey), key_ops: ["verify"] },
              { name: "Ed25519" },
              false,
              ["verify"],
            );
            const valid = await globalThis.crypto.subtle.verify({ name: "Ed25519" }, cryptoPub, rawSigBuf, toVerifyBuf);
            if (!valid) {
              await writeText(context.stderr, "Signature verification failed\n");
              return { exitCode: 1 };
            }
            const fp = await computeFingerprintSha256(pubKey);
            await writeText(
              context.stdout,
              `Good "${textDecoder.decode(sigNs)}" signature for ${signerIdentity ?? "principal"} with ED25519 key ${fp}\n`,
            );
            return { exitCode: 0 };
          }
        }

        if (derivePub) {
          const keyPath = pathPosix.resolve(context.cwd, fileArg ?? "/home/user/.ssh/id_ed25519");
          const pem = textDecoder.decode(await readLimitedFile(context, keyPath, maxBytes));
          const parsed = parseOpenSshEd25519PrivateKey(pem);
          if (!parsed) throw new PublicDiagnostic(`invalid OpenSSH private key: ${keyPath}`);
          const pubLine = `ssh-ed25519 ${bytesToBase64(sshEd25519PubkeyBlob(parsed.pubKey))} ${parsed.comment}\n`;
          await writeText(context.stdout, pubLine);
          return { exitCode: 0 };
        }

        if (showFingerprint) {
          const keyPath = pathPosix.resolve(context.cwd, fileArg ?? "/home/user/.ssh/id_ed25519.pub");
          const content = textDecoder.decode(await readLimitedFile(context, keyPath, maxBytes));
          const privParsed = parseOpenSshEd25519PrivateKey(content);
          const pubParsed = privParsed ?? parseOpenSshEd25519PublicKey(content);
          if (!pubParsed) throw new PublicDiagnostic(`not a public key file: ${keyPath}`);
          const fp = await computeFingerprintSha256(pubParsed.pubKey);
          await writeText(context.stdout, `256 ${fp} ${pubParsed.comment || keyPath} (ED25519)\n`);
          return { exitCode: 0 };
        }

        // Default: generate new Ed25519 keypair
        const outPath = pathPosix.resolve(context.cwd, fileArg ?? "/home/user/.ssh/id_ed25519");
        const dirPath = pathPosix.dirname(outPath);
        await context.fs.mkdir(dirPath, { recursive: true });
        const keyPair = (await globalThis.crypto.subtle.generateKey({ name: "Ed25519" }, true, [
          "sign",
          "verify",
        ])) as unknown as { privateKey: CryptoKey; publicKey: CryptoKey };
        const jwk = await globalThis.crypto.subtle.exportKey("jwk", keyPair.privateKey);
        const fromB64Url = (s: string) => base64ToBytes(s.replace(/-/g, "+").replace(/_/g, "/"));
        const seed = fromB64Url(jwk.d!);
        const pubKey = fromB64Url(jwk.x!);

        const privPem = formatOpenSshEd25519PrivateKey(seed, pubKey, comment);
        const pubLine = `ssh-ed25519 ${bytesToBase64(sshEd25519PubkeyBlob(pubKey))} ${comment}\n`;
        await writeFileOutput(context, textEncoder.encode(privPem), data =>
          context.fs.writeFile(outPath, data, { signal: context.signal }),
        );
        await writeFileOutput(context, textEncoder.encode(pubLine), data =>
          context.fs.writeFile(`${outPath}.pub`, data, { signal: context.signal }),
        );
        const fp = await computeFingerprintSha256(pubKey);
        await writeText(
          context.stdout,
          `Generating public/private ed25519 key pair.\nYour identification has been saved in ${outPath}\nYour public key has been saved in ${outPath}.pub\nThe key fingerprint is:\n${fp} ${comment}\n`,
        );
        return { exitCode: 0 };
      } catch (err) {
        context.signal.throwIfAborted();
        const msg = err instanceof Error ? err.message : String(err);
        await writeText(context.stderr, `ssh-keygen: ${msg}\n`);
        return { exitCode: 1 };
      }
    },
  };
}

export function createSshCommand(options: SshCommandsOptions = {}): CommandDefinition {
  const _limits = settings(options);
  return {
    name: "ssh",
    description: "OpenSSH remote login and Git transport client",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      const args = getCommandArguments(context).args;
      if (args.includes("-V")) {
        await writeText(context.stderr, "OpenSSH_9.8p1, OpenSSL 3.3.2 3 Sep 2024\n");
        return { exitCode: 0 };
      }
      let dumpConfig = false;
      let port = 22;
      let user = "git";
      let identityFile = "/home/user/.ssh/id_ed25519";
      let destination = "localhost";
      const remoteCmd: string[] = [];

      for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if (a === "-G") dumpConfig = true;
        else if (a === "-p" && i + 1 < args.length) port = Number.parseInt(args[++i]!, 10) || 22;
        else if (a === "-l" && i + 1 < args.length) user = args[++i]!;
        else if (a === "-i" && i + 1 < args.length) identityFile = args[++i]!;
        else if (a === "-o" && i + 1 < args.length) i++;
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
        await writeText(
          context.stdout,
          `user ${user}\nhostname ${destination}\nport ${port}\nidentityfile ${identityFile}\n`,
        );
        return { exitCode: 0 };
      }

      if (remoteCmd.length === 0) {
        await writeText(context.stderr, `Hi ${user}! You've successfully authenticated, but ${destination} does not provide interactive shell access.\n`);
        return { exitCode: 1 };
      }

      await writeText(context.stdout, `ssh:${user}@${destination}:${port} ${remoteCmd.join(" ")}\n`);
      return { exitCode: 0 };
    },
  };
}

export function createSshCommands(options: SshCommandsOptions = {}): readonly CommandDefinition[] {
  return [createSshCommand(options), createSshKeygenCommand(options)];
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
