import { createHash } from "node:crypto";
import { FsError, readBytes, toByteSource, type ByteSource, type CommandContext, type CommandDefinition } from "../../../contracts/index.js";
import { codeOf, define, diagnostic, encoder, options, output, pathOf, UsageError, value } from "../../internal.js";

const blockBytes = 64 * 1024;
const manifestLineBytes = 64 * 1024;
const filenameBytes = 16 * 1024;
const maxLength = (1n << 64n) - 1n;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
type Algorithm = "sha512" | "sha384" | "sha256" | "sha224" | "sha1" | "md5" | "crc";
type ReportMode = "normal" | "quiet" | "status" | "warn";

interface Settings {
  operands: string[];
  binary: boolean;
  check: boolean;
  zero: boolean;
  strict: boolean;
  ignoreMissing: boolean;
  report: ReportMode;
}

interface InputState { stdinUsed: boolean }
interface ReadProgress { hasData: boolean }
interface Digest { hex: string; length: bigint }
interface Entry { digest: string; filename: string }

function parseCksum(args: readonly string[]): { algorithm: Algorithm; settings: Settings } {
  const parsed = options(args, "a:z", { algorithm: "a", zero: "z" });
  const algorithm = value(parsed, "a") ?? "crc";
  if (!["crc", "md5", "sha1", "sha224", "sha256", "sha384", "sha512"].includes(algorithm)) throw new UsageError(`unsupported checksum algorithm '${algorithm}'`);
  return { algorithm: algorithm as Algorithm, settings: { operands: parsed.operands, binary: false, check: false, zero: parsed.flags.has("z"), strict: false, ignoreMissing: false, report: "normal" } };
}

function parse(args: readonly string[], algorithm: Algorithm): Settings {
  const settings: Settings = { operands: [], binary: false, check: false, zero: false, strict: false, ignoreMissing: false, report: "normal" };
  if (algorithm === "crc") {
    const parsed = options(args, "z", { zero: "z" });
    settings.operands = parsed.operands;
    settings.zero = parsed.flags.has("z");
    return settings;
  }
  const aliases: Readonly<Record<string, string>> = {
    binary: "b", text: "t", check: "c", zero: "z", warn: "w",
    quiet: "quiet", status: "status", strict: "strict", "ignore-missing": "ignore-missing",
  };
  let ended = false;
  let explicitMode = false;
  let checkOnly = false;
  for (const argument of args) {
    if (ended || argument === "-" || !argument.startsWith("-")) { settings.operands.push(argument); continue; }
    if (argument === "--") { ended = true; continue; }
    const keys = argument.startsWith("--") ? [aliases[argument.slice(2)] ?? ""] : [...argument.slice(1)];
    for (const key of keys) {
      switch (key) {
        case "b": settings.binary = true; explicitMode = true; break;
        case "t": settings.binary = false; explicitMode = true; break;
        case "c": settings.check = true; break;
        case "z": settings.zero = true; break;
        case "w": settings.report = "warn"; checkOnly = true; break;
        case "quiet": case "status": settings.report = key; checkOnly = true; break;
        case "strict": settings.strict = true; checkOnly = true; break;
        case "ignore-missing": settings.ignoreMissing = true; checkOnly = true; break;
        default: throw new UsageError(`unrecognized option '${argument}'`);
      }
    }
  }
  if (!settings.check && checkOnly) throw new UsageError("verification options require --check");
  if (settings.check && (settings.zero || explicitMode)) throw new UsageError("--zero, --binary and --text are not supported with --check");
  return settings;
}

function validateFilename(filename: string): void {
  if (filename.length > filenameBytes) throw new FsError("ENAMETOOLONG", { message: "filename exceeds 16384 UTF-8 bytes" });
  const bytes = encoder.encode(filename);
  if (!filename || filename.includes("\0") || utf8.decode(bytes) !== filename) throw new FsError("EINVAL", { message: "filename must be nonempty, NUL-free, valid Unicode" });
  if (bytes.length > filenameBytes) throw new FsError("ENAMETOOLONG", { message: "filename exceeds 16384 UTF-8 bytes" });
}

function source(context: CommandContext, filename: string, state: InputState): ByteSource {
  validateFilename(filename);
  if (filename === "-") {
    if (state.stdinUsed) return toByteSource("");
    state.stdinUsed = true;
    return context.stdin;
  }
  const path = pathOf(context, filename);
  if (!context.fs.readStream) throw new FsError("ENOTSUP", { message: "checksum file input requires VFS readStream" });
  return context.fs.readStream(path, { signal: context.signal, chunkSize: blockBytes });
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
        await new Promise<void>(resolve => setImmediate(resolve));
        signal.throwIfAborted();
        work = 0;
        pulls = 0;
      }
    }
    if (pulls >= 256) {
      await new Promise<void>(resolve => setImmediate(resolve));
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

async function digest(input: ByteSource, algorithm: Algorithm, signal: AbortSignal, progress?: ReadProgress): Promise<Digest> {
  const hash = algorithm === "crc" ? undefined : createHash(algorithm);
  let crc = 0;
  let length = 0n;
  for await (const block of blocks(input, signal)) {
    if (progress) progress.hasData = true;
    length += BigInt(block.length);
    if (length > maxLength) throw new FsError("EFBIG", { message: "checksum input exceeds 2^64-1 bytes" });
    if (hash) hash.update(block);
    else for (const byte of block) crc = (crc << 8) ^ crcTable[((crc >>> 24) ^ byte) & 255]!;
  }
  if (hash) return { hex: hash.digest("hex"), length };
  for (let remaining = length; remaining > 0n; remaining >>= 8n) {
    crc = (crc << 8) ^ crcTable[((crc >>> 24) ^ Number(remaining & 255n)) & 255]!;
  }
  return { hex: String((~crc) >>> 0), length };
}

function escaped(filename: string): { prefix: string; name: string } {
  return /[\\\n\r]/u.test(filename)
    ? { prefix: "\\", name: filename.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r") }
    : { prefix: "", name: filename };
}

async function* manifestLines(input: ByteSource, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const buffer = new Uint8Array(manifestLineBytes);
  let size = 0;
  for await (const block of blocks(input, signal)) {
    let start = 0;
    for (let offset = 0; offset <= block.length; offset++) {
      if (offset !== block.length && block[offset] !== 10) continue;
      const added = offset - start;
      if (size + added > buffer.length) throw new FsError("EFBIG", { message: "manifest line exceeds 65536 bytes" });
      buffer.set(block.subarray(start, offset), size);
      size += added;
      if (offset < block.length) { yield buffer.subarray(0, size); size = 0; }
      start = offset + 1;
    }
  }
  if (size) yield buffer.subarray(0, size);
}

function parseEntry(bytes: Uint8Array, algorithm: Algorithm): Entry | "skip" | undefined {
  let line: string;
  try { line = utf8.decode(bytes); } catch { return undefined; }
  if (line.endsWith("\r")) line = line.slice(0, -1);
  if (line === "" || line.startsWith("#")) return "skip";
  const digits = { sha512: 128, sha384: 96, sha256: 64, sha224: 56, sha1: 40, md5: 32, crc: 0 }[algorithm];
  const match = new RegExp(`^[ \\t]*(\\\\?)([a-fA-F0-9]{${digits}})[ \\t][ *](.+)$`, "su").exec(line);
  if (!match) return undefined;
  let filename = match[3]!;
  if (match[1]) {
    let invalid = false;
    filename = filename.replace(/\\([\s\S]?)/gu, (_, character: string) => {
      if (character === "n") return "\n";
      if (character === "r") return "\r";
      if (character === "\\") return "\\";
      invalid = true;
      return "";
    });
    if (invalid) return undefined;
  }
  try { validateFilename(filename); } catch { return undefined; }
  return { digest: match[2]!.toLowerCase(), filename };
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
    const entry = parseEntry(line, algorithm);
    if (entry === "skip") continue;
    if (!entry || (manifest === "-" && entry.filename === "-")) {
      malformed++;
      if (settings.report === "warn") await diagnostic(context, `${escaped(manifest).name}: ${lineNumber}: improperly formatted ${algorithm} checksum line`);
      continue;
    }
    valid = true;
    let actual: Digest;
    const progress: ReadProgress = { hasData: false };
    try { actual = await digest(source(context, entry.filename, state), algorithm, context.signal, progress); }
    catch (error) {
      context.signal.throwIfAborted();
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
  if (!valid) await diagnostic(context, `${escaped(manifest).name}: no properly formatted checksum lines found`);
  else if (settings.report !== "status") {
    if (malformed) await diagnostic(context, `WARNING: ${malformed} improperly formatted checksum line(s)`);
    if (failures) await diagnostic(context, `WARNING: ${failures} listed file(s) could not be read`);
    if (mismatched) await diagnostic(context, `WARNING: ${mismatched} computed checksum(s) did NOT match`);
    if (settings.ignoreMissing && !matched) await diagnostic(context, `${escaped(manifest).name}: no file was verified`);
  }
  return valid && matched && !failures && !mismatched && (!settings.strict || !malformed);
}

function command(name: string, algorithm: Algorithm): CommandDefinition {
  return define(name, async context => {
    const selected = name === "cksum" ? parseCksum(context.args) : { algorithm, settings: parse(context.args, algorithm) };
    const selectedAlgorithm = selected.algorithm;
    const settings = selected.settings;
    const state: InputState = { stdinUsed: false };
    let failed = false;
    for (const filename of settings.operands.length ? settings.operands : ["-"]) {
      context.signal.throwIfAborted();
      if (settings.check) {
        try { if (!await verify(context, filename, selectedAlgorithm, settings, state)) failed = true; }
        catch (error) { await diagnostic(context, error); failed = true; }
        continue;
      }
      let result: Digest;
      try { result = await digest(source(context, filename, state), selectedAlgorithm, context.signal); }
      catch (error) { await diagnostic(context, error); failed = true; continue; }
      const delimiter = settings.zero ? "\0" : "\n";
      if (selectedAlgorithm === "crc") await output(context, `${result.hex} ${result.length}${settings.operands.length ? ` ${filename}` : ""}${delimiter}`);
      else {
        const display = settings.zero ? { prefix: "", name: filename } : escaped(filename);
        await output(context, name === "cksum"
          ? `${display.prefix}${selectedAlgorithm.toUpperCase()} (${display.name}) = ${result.hex}${delimiter}`
          : `${display.prefix}${result.hex} ${settings.binary ? "*" : " "}${display.name}${delimiter}`);
      }
    }
    return { exitCode: failed ? 1 : 0 };
  });
}

export function createChecksumCommands(): readonly CommandDefinition[] {
  return [command("sha256sum", "sha256"), command("sha1sum", "sha1"), command("md5sum", "md5"), command("cksum", "crc")];
}
