import { shellValueByteLength } from "safe-bash-contracts/value";
import { yieldTurn } from "safe-bash-contracts/yield";
import { SM3 } from "./sm3.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { sha3_224, sha3_256, sha3_384, sha3_512 } from "@noble/hashes/sha3.js";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { md5, sha1 } from "@noble/hashes/legacy.js";
import { sha224, sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { FsError, getCommandArguments, readBytes, type ByteSource, type CommandContext, type CommandDefinition } from "safe-bash-contracts";
import { codeOf, define, diagnostic, encoder, options, output, pathOf, UsageError, value } from "safe-bash-io-engine/internal";
import { ByteInputBudget } from "safe-bash-byte-input-engine/index";

const blockBytes = 64 * 1024;
const filenameBytes = 16 * 1024;
const maxLength = (1n << 64n) - 1n;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
type Algorithm = "sha512" | "sha384" | "sha256" | "sha224" | "sha1" | "md5" | "crc" | "bsd" | "sysv" | "crc32b" | "sm3" | "blake2b" | "sha3";
const hashes = { sha512, sha384, sha256, sha224, sha1, md5, sm3: { create: () => new SM3() } };
const numericAlgorithms = new Set<Algorithm>(["crc", "crc32b", "bsd", "sysv"]);
type HashAlgorithm = keyof typeof hashes | "blake2b" | "sha3";
interface IncrementalHash {
  update(bytes: Uint8Array): void;
  digest(): Uint8Array;
  destroy(): void;
}

export function createHash(algorithm: HashAlgorithm, bits = 512): IncrementalHash {
  if (algorithm === "blake2b") return blake2b.create({ dkLen: bits / 8 });
  if (algorithm === "sha3") return ({ 224: sha3_224, 256: sha3_256, 384: sha3_384, 512: sha3_512 }[bits]!).create();
  return hashes[algorithm].create();
}
type ReportMode = "normal" | "quiet" | "status" | "warn";

interface Settings {
  operands: string[];
  binary: boolean;
  check: boolean;
  zero: boolean;
  tag: boolean;
  strict: boolean;
  ignoreMissing: boolean;
  report: ReportMode;
  encoding?: "raw" | "base64";
  length?: number;
  label?: string;
}

interface InputState { stdinUsed: boolean; budget: ByteInputBudget }
interface ReadProgress { hasData: boolean }
interface Digest { hex: string; length: bigint }
interface Entry { digest: string; filename: string; algorithm: Algorithm; bits?: number }

function parseCksum(args: readonly string[]): { algorithm: Algorithm; settings: Settings } {
  let report: ReportMode = "normal";
  let lastTag: boolean | undefined;
  const parsed = options(args, "a:l:bczw", { length: "l", check: "c", warn: "w", quiet: false, status: false, strict: false, "ignore-missing": false, algorithm: "a", binary: "b", tag: false, zero: "z", untagged: false, raw: false, base64: false },
    false, undefined, undefined, key => {
      if (key === "quiet" || key === "status") report = key;
      if (key === "w") report = "warn";
      if (key === "tag") lastTag = true;
      if (key === "untagged") lastTag = false;
    });
  let algorithm = value(parsed, "a") ?? "crc";
  if (!["crc", "bsd", "sysv", "crc32b", "sm3", "blake2b", "sha2", "sha3", ...Object.keys(hashes)].includes(algorithm)) throw new UsageError(`unsupported checksum algorithm '${algorithm}'`);
  const requestedLength = value(parsed, "l");
  const check = parsed.flags.has("c");
  const length = requestedLength === undefined ? 0 : Number(requestedLength);
  if (requestedLength !== undefined && (!requestedLength.length || ![...requestedLength].every(c => c >= "0" && c <= "9") || !Number.isSafeInteger(length))) throw new UsageError(`invalid length '${requestedLength}'`);
  const family = algorithm === "sha2" || algorithm === "sha3";
  if (family && !(check && requestedLength === undefined && algorithm === "sha3") && ![224, 256, 384, 512].includes(length)) throw new UsageError(`${algorithm} requires --length 224, 256, 384 or 512`);
  if (length && (family ? ![224, 256, 384, 512].includes(length) : algorithm === "blake2b" ? length > 512 || length % 8 !== 0 : true)) throw new UsageError(`invalid length '${requestedLength}' for ${algorithm}`);
  const bits = length || 512;
  if (algorithm === "sha2") algorithm = `sha${bits}`;
  const label = algorithm === "blake2b" ? `BLAKE2b${bits === 512 ? "" : `-${bits}`}` : algorithm === "sha3" ? `SHA3-${bits}` : algorithm.toUpperCase();
  if (parsed.flags.has("raw") && (numericAlgorithms.has(algorithm as Algorithm) || ["tag", "untagged", "base64", "z"].some(flag => parsed.flags.has(flag)))) {
    throw new UsageError("--raw requires a hash algorithm and cannot be combined with --tag, --untagged, --base64 or --zero");
  }
  if (check && numericAlgorithms.has(algorithm as Algorithm) && algorithm !== "crc") throw new UsageError(`verification is not supported for '${algorithm}'`);
  if (!check && (report !== "normal" || parsed.flags.has("strict") || parsed.flags.has("ignore-missing"))) throw new UsageError("verification options require --check");
  if (check && ["b", "z", "tag", "raw", "base64"].some(flag => parsed.flags.has(flag))) throw new UsageError("output options are not supported with --check");
  return { algorithm: algorithm as Algorithm, settings: {
    length: bits, label,
    operands: parsed.operands, binary: parsed.flags.has("b"), check,
    zero: parsed.flags.has("z"), tag: lastTag ?? true,
    strict: parsed.flags.has("strict"), ignoreMissing: parsed.flags.has("ignore-missing"), report,
    ...(parsed.flags.has("raw") ? { encoding: "raw" as const } : parsed.flags.has("base64") ? { encoding: "base64" as const } : {}),
  } };
}

function parse(args: readonly string[], algorithm: Algorithm): Settings {
  const settings: Settings = { operands: [], binary: false, check: false, zero: false, tag: false, strict: false, ignoreMissing: false, report: "normal" };
  if (algorithm === "crc") {
    const parsed = options(args, "z", { zero: "z" });
    settings.operands = parsed.operands;
    settings.zero = parsed.flags.has("z");
    return settings;
  }
  const aliases: Readonly<Record<string, string>> = {
    binary: "b", text: "t", check: "c", zero: "z", warn: "w", tag: "tag",
    quiet: "quiet", status: "status", strict: "strict", "ignore-missing": "ignore-missing",
  };
  let ended = false;
  let explicitMode = false;
  let explicitText = false;
  let checkOnly = false;
  for (const argument of args) {
    if (ended || argument === "-" || !argument.startsWith("-")) { settings.operands.push(argument); continue; }
    if (argument === "--") { ended = true; continue; }
    const keys = argument.startsWith("--") ? [aliases[argument.slice(2)] ?? ""] : [...argument.slice(1)];
    for (const key of keys) {
      switch (key) {
        case "b": settings.binary = true; explicitMode = true; explicitText = false; break;
        case "t": settings.binary = false; explicitMode = true; explicitText = true; break;
        case "c": settings.check = true; break;
        case "z": settings.zero = true; break;
        case "tag": settings.tag = true; if (!explicitText) settings.binary = true; break;
        case "w": settings.report = "warn"; checkOnly = true; break;
        case "quiet": case "status": settings.report = key; checkOnly = true; break;
        case "strict": settings.strict = true; checkOnly = true; break;
        case "ignore-missing": settings.ignoreMissing = true; checkOnly = true; break;
        default: throw new UsageError(`unrecognized option '${argument}'`);
      }
    }
  }
  if (!settings.check && checkOnly) throw new PublicDiagnostic("verification options require --check");
  if (settings.tag && settings.check) throw new UsageError("the --tag option is meaningless when verifying checksums");
  if (settings.tag && !settings.binary) throw new UsageError("--tag does not support --text mode");
  if (settings.check && (settings.zero || explicitMode)) throw new UsageError("--zero, --binary and --text are not supported with --check");
  return settings;
}

function validateFilename(filename: string): void {
  if (filename.length > filenameBytes) throw new FsError("ENAMETOOLONG", { message: "filename exceeds 16384 UTF-8 bytes" });
  const bytes = encoder.encode(filename);
  if (!filename || filename.includes("\0") || utf8.decode(bytes) !== filename) throw new FsError("EINVAL", { message: "filename must be nonempty, NUL-free, valid Unicode" });
  if (bytes.length > filenameBytes) throw new FsError("ENAMETOOLONG", { message: "filename exceeds 16384 UTF-8 bytes" });
}

async function* source(context: CommandContext, filename: string, state: InputState): AsyncGenerator<Uint8Array> {
  state.budget.assertOpen(context.signal);
  validateFilename(filename);
  if (filename === "-") {
    if (state.stdinUsed) return;
    state.stdinUsed = true;
    yield* state.budget.read(context.stdin, context.signal);
    return;
  }
  const path = pathOf(context, filename);
  if (!context.fs.readStream) throw new FsError("ENOTSUP", { message: "checksum file input requires VFS readStream" });
  try {
    yield* state.budget.read(context.fs.readStream(path, { signal: context.signal, chunkSize: blockBytes }), context.signal);
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof FsError && error.code === "EISDIR") throw new PublicDiagnostic(`${escaped(filename).name}: Is a directory`);
    throw error;
  }
}

async function* blocks(input: ByteSource, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  let work = 0;
  let pulls = 0;
  for await (const chunk of readBytes(input, signal)) {
    pulls++;
    for (let offset = 0; offset < chunk.length; offset += blockBytes) {
      signal.throwIfAborted();
      const block = chunk.subarray(offset, offset + blockBytes);
      yield block;
      work += block.length;
      if (work >= blockBytes) {
        await yieldTurn();
        signal.throwIfAborted();
        work = 0;
        pulls = 0;
      }
    }
    if (pulls >= 256) {
      await yieldTurn();
      signal.throwIfAborted();
      pulls = 0;
    }
  }
  signal.throwIfAborted();
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let remainder = index << 24;
  for (let bit = 0; bit < 8; bit++) remainder = (remainder << 1) ^ (remainder < 0 ? 0x04c11db7 : 0);
  return remainder >>> 0;
});

export async function digest(input: ByteSource, algorithm: Algorithm, signal: AbortSignal, progress?: ReadProgress, bits = 512): Promise<Digest> {
  const hash = numericAlgorithms.has(algorithm) ? undefined : createHash(algorithm as HashAlgorithm, bits);
  let crc = algorithm === "crc32b" ? 0xffffffff : 0;
  let length = 0n;
  try {
    for await (const block of blocks(input, signal)) {
      if (progress) progress.hasData = true;
      length += BigInt(block.length);
      if (length > maxLength) throw new FsError("EFBIG", { message: "checksum input exceeds 2^64-1 bytes" });
      if (hash) hash.update(block);
      else for (const byte of block) {
        if (algorithm === "bsd") crc = (((crc >>> 1) | ((crc & 1) << 15)) + byte) & 65535;
        else if (algorithm === "sysv") crc = (crc + byte) >>> 0;
        else if (algorithm === "crc32b") {
          crc ^= byte;
          for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        } else crc = (crc << 8) ^ crcTable[((crc >>> 24) ^ byte) & 255]!;
      }
    }
    if (hash) return { hex: bytesToHex(hash.digest()), length };
    if (algorithm === "bsd") return { hex: String(crc).padStart(5, "0"), length };
    if (algorithm === "sysv") {
      crc = (crc & 65535) + (crc >>> 16);
      return { hex: String((crc & 65535) + (crc >>> 16)), length };
    }
    if (algorithm === "crc32b") return { hex: String((~crc) >>> 0), length };
    for (let remaining = length; remaining > 0n; remaining >>= 8n) {
      crc = (crc << 8) ^ crcTable[((crc >>> 24) ^ Number(remaining & 255n)) & 255]!;
    }
    return { hex: String((~crc) >>> 0), length };
  } finally { hash?.destroy(); }
}

function escaped(filename: string): { prefix: string; name: string } {
  return /[\\\n\r]/u.test(filename)
    ? { prefix: "\\", name: filename.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r") }
    : { prefix: "", name: filename };
}

async function* manifestLines(input: ByteSource, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  let buffer = new Uint8Array(4096);
  let size = 0;
  for await (const block of blocks(input, signal)) {
    let start = 0;
    for (let offset = 0; offset <= block.length; offset++) {
      if (offset !== block.length && block[offset] !== 10) continue;
      const added = offset - start;
      if (size + added > buffer.length) {
        let nextLength = buffer.length;
        while (nextLength < size + added) nextLength *= 2;
        const next = new Uint8Array(nextLength);
        next.set(buffer.subarray(0, size));
        buffer = next;
      }
      buffer.set(block.subarray(start, offset), size);
      size += added;
      if (offset < block.length) { yield buffer.subarray(0, size); size = 0; }
      start = offset + 1;
    }
  }
  if (size) yield buffer.subarray(0, size);
}

function parseEntry(bytes: Uint8Array, algorithm: Algorithm, allowBase64: boolean): Entry | "skip" | undefined {
  let line: string;
  try { line = utf8.decode(bytes); } catch { return undefined; }
  if (line.endsWith("\r")) line = line.slice(0, -1);
  if (line === "" || line.startsWith("#")) return "skip";
  while (line.startsWith(" ") || line.startsWith("\t")) line = line.slice(1);
  const escapedName = line.startsWith("\\");
  if (escapedName) line = line.slice(1);
  const hashBits = { sha512: 512, sha384: 384, sha256: 256, sha224: 224, sha1: 160, md5: 128, sm3: 256 };
  let bits: number | undefined;
  let encoded: string;
  let filename: string;
  const opening = line.indexOf("(");
  const closing = line.lastIndexOf(")");
  const rawLabel = opening < 0 ? "" : line.slice(0, opening);
  const label = rawLabel.endsWith(" ") ? rawLabel.slice(0, -1) : rawLabel;
  let taggedAlgorithm: HashAlgorithm | undefined;
  if (label === "BLAKE2b" || label.startsWith("BLAKE2b-")) {
    taggedAlgorithm = "blake2b";
    const size = label === "BLAKE2b" ? "512" : label.slice(8);
    if (!size.length || ![...size].every(c => c >= "0" && c <= "9")) return undefined;
    bits = Number(size);
    if (bits < 8 || bits > 512 || bits % 8 !== 0) return undefined;
  } else if (label.startsWith("SHA3-")) {
    taggedAlgorithm = "sha3";
    const size = label.slice(5);
    if (!["224", "256", "384", "512"].includes(size)) return undefined;
    bits = Number(size);
  } else {
    taggedAlgorithm = (Object.keys(hashBits) as (keyof typeof hashBits)[]).find(candidate => label === candidate.toUpperCase());
    if (taggedAlgorithm) bits = hashBits[taggedAlgorithm];
  }
  if (taggedAlgorithm) {
    if (algorithm !== "crc" && algorithm !== taggedAlgorithm) return undefined;
    algorithm = taggedAlgorithm;
    if (closing <= opening) return undefined;
    let suffix = line.slice(closing + 1);
    while (suffix.startsWith(" ") || suffix.startsWith("\t")) suffix = suffix.slice(1);
    if (!suffix.startsWith("=")) return undefined;
    encoded = suffix.slice(1);
    while (encoded.startsWith(" ") || encoded.startsWith("\t")) encoded = encoded.slice(1);
    filename = line.slice(opening + 1, closing);
  } else {
    if (algorithm === "crc" || numericAlgorithms.has(algorithm)) return undefined;
    const separator = [...line].findIndex(c => c === " " || c === "\t");
    if (separator < 0 || ![" ", "*"].includes(line[separator + 1]!)) return undefined;
    encoded = line.slice(0, separator);
    filename = line.slice(separator + 2);
    if (algorithm !== "blake2b" && algorithm !== "sha3") bits = hashBits[algorithm as keyof typeof hashBits];
  }
  // Require canonical encodings and the size declared by the tag. Never let
  // digest text select a different SHA3 or BLAKE2b variant than the label.
  if (!encoded.length || encoded.length > 128) return undefined;
  let hex: string;
  if (encoded.length % 2 === 0 && [...encoded].every(c => "0123456789abcdefABCDEF".includes(c)) && (bits === undefined || encoded.length * 4 === bits)) {
    hex = encoded.toLowerCase();
  } else {
    if (!allowBase64) return undefined;
    let decoded: string;
    try { decoded = atob(encoded); } catch { return undefined; }
    if (btoa(decoded) !== encoded) return undefined;
    hex = bytesToHex(Uint8Array.from(decoded, c => c.charCodeAt(0)));
  }
  const digestBits = hex.length * 4;
  if (bits !== undefined && digestBits !== bits) return undefined;
  if (algorithm === "blake2b" && (digestBits < 8 || digestBits > 512)) return undefined;
  if (algorithm === "sha3" && ![224, 256, 384, 512].includes(digestBits)) return undefined;
  if (escapedName) {
    let decoded = "";
    for (let index = 0; index < filename.length; index++) {
      const character = filename[index]!;
      if (character !== "\\") { decoded += character; continue; }
      const escape = filename[++index];
      if (escape === "n") decoded += "\n";
      else if (escape === "r") decoded += "\r";
      else if (escape === "\\") decoded += "\\";
      else return undefined;
    }
    filename = decoded;
  }
  try { validateFilename(filename); } catch { return undefined; }
  return { digest: hex, filename, algorithm, bits: digestBits };
}

async function report(context: CommandContext, filename: string, status: string): Promise<void> {
  const display = escaped(filename);
  await output(context, `${display.prefix}${display.name}: ${status}\n`);
}

async function verify(context: CommandContext, manifest: string, algorithm: Algorithm, settings: Settings, state: InputState): Promise<boolean> {
  let malformed = 0;
  let mismatched = 0;
  let failures = 0;
  let valid = false;
  let matched = false;
  let lineNumber = 0;
  for await (const line of manifestLines(source(context, manifest, state), context.signal)) {
    if (++lineNumber > Number.MAX_SAFE_INTEGER) throw new FsError("EFBIG", { message: "too many manifest lines" });
    const entry = parseEntry(line, algorithm, context.command === "cksum");
    if (entry === "skip") continue;
    if (!entry || (manifest === "-" && entry.filename === "-")) {
      malformed++;
      if (settings.report === "warn") await diagnostic(context, new PublicDiagnostic(`${escaped(manifest).name}: ${lineNumber}: improperly formatted ${algorithm} checksum line`));
      continue;
    }
    valid = true;
    let actual: Digest;
    const progress: ReadProgress = { hasData: false };
    try { actual = await digest(source(context, entry.filename, state), entry.algorithm, context.signal, progress, entry.bits ?? settings.length ?? 512); }
    catch (error) {
      state.budget.assertOpen(context.signal);
      if (settings.ignoreMissing && entry.filename !== "-" && !progress.hasData && codeOf(error) === "ENOENT") continue;
      failures++;
      await diagnostic(context, error);
      if (settings.report !== "status") await report(context, entry.filename, "FAILED open or read");
      continue;
    }
    const match = actual.hex === entry.digest;
    if (match) matched = true;
    else mismatched++;
    if (settings.report !== "status" && (!match || settings.report !== "quiet")) await report(context, entry.filename, match ? "OK" : "FAILED");
  }
  if (!valid) await diagnostic(context, new PublicDiagnostic(`${escaped(manifest).name}: no properly formatted checksum lines found`));
  else if (settings.report !== "status") {
    if (malformed) await diagnostic(context, new PublicDiagnostic(`WARNING: ${malformed} improperly formatted checksum line(s)`));
    if (failures) await diagnostic(context, new PublicDiagnostic(`WARNING: ${failures} listed file(s) could not be read`));
    if (mismatched) await diagnostic(context, new PublicDiagnostic(`WARNING: ${mismatched} computed checksum(s) did NOT match`));
    if (settings.ignoreMissing && !matched) await diagnostic(context, new PublicDiagnostic(`${escaped(manifest).name}: no file was verified`));
  }
  return valid && matched && !failures && !mismatched && (!settings.strict || !malformed);
}

export function command(name: string, algorithm: Algorithm, maxInputBytes: number, maxArgumentBytes = Infinity): CommandDefinition {
  return define(name, async context => {
    if (maxArgumentBytes !== Infinity) {
      const arguments_ = getCommandArguments(context);
      let argumentBytes = 0;
      for (let index = 0; index < arguments_.args.length; index++) {
        const bytes = shellValueByteLength(arguments_.values[index]!);
        if (bytes > maxArgumentBytes - argumentBytes) throw new FsError("EFBIG", { message: "checksum argument limit exceeded" });
        argumentBytes += bytes;
      }
    }
    const selected = name === "cksum" ? parseCksum(context.args) : { algorithm, settings: parse(context.args, algorithm) };
    const selectedAlgorithm = selected.algorithm;
    const settings = selected.settings;
    const state: InputState = { stdinUsed: false, budget: new ByteInputBudget(maxInputBytes, context.inputBudget) };
    let failed = false;
    for (const filename of settings.operands.length ? settings.operands : ["-"]) {
      await yieldTurn(context.signal);
      context.signal.throwIfAborted();
      if (settings.check) {
        try { if (!await verify(context, filename, selectedAlgorithm, settings, state)) failed = true; }
        catch (error) { state.budget.assertOpen(context.signal); await diagnostic(context, error); failed = true; }
        continue;
      }
      let result: Digest;
      try { result = await digest(source(context, filename, state), selectedAlgorithm, context.signal, undefined, settings.length); }
      catch (error) { state.budget.assertOpen(context.signal); await diagnostic(context, error); failed = true; continue; }
      const delimiter = settings.zero ? "\0" : "\n";
      if (numericAlgorithms.has(selectedAlgorithm)) {
        const size = selectedAlgorithm === "bsd" ? (result.length + 1023n) / 1024n : selectedAlgorithm === "sysv" ? (result.length + 511n) / 512n : result.length;
        const count = selectedAlgorithm === "bsd" ? String(size).padStart(5, " ") : String(size);
        await output(context, `${result.hex} ${count}${settings.operands.length ? ` ${filename}` : ""}${delimiter}`);
      }
      else {
        if (settings.encoding === "raw") {
          await output(context, hexToBytes(result.hex));
          continue;
        }
        const encoded = settings.encoding === "base64"
          ? btoa(String.fromCharCode(...hexToBytes(result.hex))) : result.hex;
        const display = settings.zero ? { prefix: "", name: filename } : escaped(filename);
        await output(context, settings.tag
          ? `${display.prefix}${settings.label ?? selectedAlgorithm.toUpperCase()} (${display.name}) = ${encoded}${delimiter}`
          : `${display.prefix}${encoded} ${settings.binary ? "*" : " "}${display.name}${delimiter}`);
      }
    }
    return { exitCode: failed ? 1 : 0 };
  });
}
function digestSync(bytes: Uint8Array, algorithm: Algorithm, bits = 512): Digest {
  const length = BigInt(bytes.byteLength);
  if (!numericAlgorithms.has(algorithm)) {
    const hash = createHash(algorithm as HashAlgorithm, bits);
    hash.update(bytes);
    return { hex: bytesToHex(hash.digest()), length };
  }
  let crc = algorithm === "crc32b" ? 0xffffffff : 0;
  for (let i = 0; i < bytes.byteLength; i++) {
    const byte = bytes[i]!;
    if (algorithm === "bsd") crc = (((crc >>> 1) | ((crc & 1) << 15)) + byte) & 65535;
    else if (algorithm === "sysv") crc = (crc + byte) >>> 0;
    else if (algorithm === "crc32b") {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    } else crc = (crc << 8) ^ crcTable[((crc >>> 24) ^ byte) & 255]!;
  }
  if (algorithm === "bsd") return { hex: String(crc).padStart(5, "0"), length };
  if (algorithm === "sysv") {
    crc = (crc & 65535) + (crc >>> 16);
    return { hex: String((crc & 65535) + (crc >>> 16)), length };
  }
  if (algorithm === "crc32b") return { hex: String((~crc) >>> 0), length };
  for (let remaining = length; remaining > 0n; remaining >>= 8n) {
    crc = (crc << 8) ^ crcTable[((crc >>> 24) ^ Number(remaining & 255n)) & 255]!;
  }
  return { hex: String((~crc) >>> 0), length };
}

export function evalSyncChecksum(
  name: string,
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (p: string) => Uint8Array | undefined,
  fileOperandName?: string,
): string | undefined {
  if (inBytes && inBytes.byteLength > 16384) return undefined;
  const baseAlg: Algorithm | undefined =
    name === "cksum" ? "crc" :
    name === "md5sum" ? "md5" :
    name === "sha1sum" ? "sha1" :
    name === "sha224sum" ? "sha224" :
    name === "sha256sum" ? "sha256" :
    name === "sha384sum" ? "sha384" :
    name === "sha512sum" ? "sha512" : undefined;
  if (!baseAlg) return undefined;
  let selectedAlgorithm: Algorithm;
  let settings: Settings;
  try {
    const effectiveArgs = fileOperandName !== undefined ? [...opArgs, fileOperandName] : opArgs;
    const selected = name === "cksum" ? parseCksum(effectiveArgs) : { algorithm: baseAlg, settings: parse(effectiveArgs, baseAlg) };
    selectedAlgorithm = selected.algorithm;
    settings = selected.settings;
  } catch {
    return undefined;
  }
  // A file-backed call supplies file bytes, not the command's inherited stdin.
  if (fileOperandName !== undefined && settings.operands.includes("-")) return undefined;
  if (settings.encoding === "raw") return undefined;
  let stdinUsed = false;
  const getBytes = (filename: string): Uint8Array | undefined => {
    try { validateFilename(filename); } catch { return undefined; }
    if (filename === "-") {
      if (inBytes === undefined) return undefined;
      if (stdinUsed) return new Uint8Array(0);
      stdinUsed = true;
      return inBytes;
    }
    if (fileOperandName !== undefined && filename === fileOperandName && settings.operands.length === 1) {
      return inBytes;
    }
    if (!readFileSync) return undefined;
    const b = readFileSync(filename);
    if (!b || b.byteLength > 16384) return undefined;
    return b;
  };
  let out = "";
  const files = settings.operands.length ? settings.operands : ["-"];
  for (const filename of files) {
    const fileBytes = getBytes(filename);
    if (!fileBytes) return undefined;
    if (settings.check) {
      let text: string;
      try { text = utf8.decode(fileBytes); } catch { return undefined; }
      const rawLines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : (text.length ? text.split("\n") : []);
      let valid = 0;
      let matched = 0;
      for (const rawLine of rawLines) {
        const parsedEntry = parseEntry(encoder.encode(rawLine), selectedAlgorithm, name === "cksum");
        if (parsedEntry === "skip") continue;
        if (!parsedEntry) return undefined;
        valid++;
        const targetBytes = getBytes(parsedEntry.filename);
        if (!targetBytes) {
          if (settings.ignoreMissing) continue;
          return undefined;
        }
        const actual = digestSync(targetBytes, parsedEntry.algorithm, parsedEntry.bits);
        if (actual.hex !== parsedEntry.digest) return undefined;
        matched++;
        if (settings.report !== "status" && settings.report !== "quiet") {
          const disp = escaped(parsedEntry.filename);
          out += `${disp.prefix}${disp.name}: OK\n`;
        }
      }
      if (!valid || !matched) return undefined;
      continue;
    }
    const result = digestSync(fileBytes, selectedAlgorithm, settings.length);
    const delimiter = settings.zero ? "\0" : "\n";
    if (numericAlgorithms.has(selectedAlgorithm)) {
      const size = selectedAlgorithm === "bsd" ? (result.length + 1023n) / 1024n : selectedAlgorithm === "sysv" ? (result.length + 511n) / 512n : result.length;
      const count = selectedAlgorithm === "bsd" ? String(size).padStart(5, " ") : String(size);
      out += `${result.hex} ${count}${settings.operands.length ? ` ${filename}` : ""}${delimiter}`;
    } else {
      const encoded = settings.encoding === "base64"
        ? btoa(String.fromCharCode(...hexToBytes(result.hex)))
        : result.hex;
      const display = settings.zero ? { prefix: "", name: filename } : escaped(filename);
      out += settings.tag
        ? `${display.prefix}${settings.label ?? selectedAlgorithm.toUpperCase()} (${display.name}) = ${encoded}${delimiter}`
        : `${display.prefix}${encoded} ${settings.binary ? "*" : " "}${display.name}${delimiter}`;
    }
  }
  return out;
}
