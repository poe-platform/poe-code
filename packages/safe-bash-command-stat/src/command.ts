const syncStatEncoder = new TextEncoder();
function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0]!;
  let total = 0;
  for (let i = 0; i < chunks.length; i++) total += chunks[i]!.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
function allocSpaces(length: number): Uint8Array {
  const out = new Uint8Array(length);
  out.fill(32);
  return out;
}
import { FsError, type CommandContext, type FileStat } from "safe-bash-contracts";
import { codeOf, diagnostic, pathOf, requireOperands, UsageError } from "safe-bash-io-engine/internal";
import { MetadataBudget, metadataCommand, permissionString, settings, type MetadataCommandsOptions } from "safe-bash-metadata-engine";

function parse(args: readonly string[]) {
  let follow = false;
  let filesystem = false;
  let terse = false;
  let format: string | undefined;
  let printf = false;
  let bsd = false;
  let literal = false;
  const paths: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (literal || argument === "-" || !argument.startsWith("-")) paths.push(argument);
    else if (argument === "--") literal = true;
    else if (argument === "--dereference") follow = true;
    else if (argument === "--cached=default" || argument === "--cached=never" || argument === "--cached=always") continue;
    else if (argument === "--file-system") filesystem = true;
    else if (argument === "--terse") terse = true;
    else if (argument === "--format" || argument.startsWith("--format=") || argument === "--printf" || argument.startsWith("--printf=")) {
      bsd = false;
      printf = argument.startsWith("--printf");
      format = argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : args[++index];
      if (format === undefined) throw new UsageError(`missing format for '${argument}'`);
    } else if (!argument.startsWith("--")) {
      for (let offset = 1; offset < argument.length; offset++) {
        if (argument[offset] === "L") follow = true;
        else if (argument[offset] === "f") {
          const next = args[index + 1];
          const formatOption = next?.startsWith("-c") || next?.startsWith("--format=") || next?.startsWith("--printf=");
          if (offset === argument.length - 1 && next?.includes("%") && !formatOption && index + 2 < args.length) {
            format = args[++index];
            bsd = true;
            filesystem = false;
            printf = false;
          } else filesystem = true;
        }
        else if (argument[offset] === "t") terse = true;
        else if (argument[offset] === "c") {
          format = argument.slice(offset + 1) || args[++index];
          if (format === undefined) throw new UsageError("missing format for '-c'");
          printf = false;
          bsd = false;
          break;
        } else throw new UsageError(`unrecognized option '${argument}'`);
      }
    } else throw new UsageError(`unrecognized option '${argument}'`);
  }
  requireOperands(paths);
  return { follow, filesystem, terse, format, printf, paths, bsd };
}

function quoted(text: string, style?: string): string {
  if (style === "literal") return text;
  if (style && !["shell-escape-always", "shell-always"].includes(style)) throw new FsError("ENOTSUP", { message: `unsupported QUOTING_STYLE: ${style}` });
  if (style !== "shell-always" && /[\x00-\x1f\x7f]/u.test(text)) {
    return "$'" + text.replace(/[\\'\x00-\x1f\x7f]/gu, character => {
      if (character === "\\" || character === "'") return `\\${character}`;
      if (character === "\n") return "\\n";
      if (character === "\r") return "\\r";
      if (character === "\t") return "\\t";
      return `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}`;
    }) + "'";
  }
  return `'${text.replace(/'/gu, "'\\''")}'`;
}

function available(value: number | undefined, field: string): number {
  if (value === undefined) throw new FsError("ENOTSUP", { syscall: "stat", message: `filesystem does not expose ${field}` });
  if (!Number.isFinite(value)) throw new FsError("EIO", { syscall: "stat", message: `invalid ${field}` });
  return value;
}

function timestamp(milliseconds: number): string {
  const value = available(milliseconds, "timestamp");
  if (Math.abs(value) > 8_640_000_000_000_000) throw new FsError("EIO", { message: "invalid filesystem timestamp" });
  const [coefficient = "0", exponent = "0"] = Math.abs(value).toString().split("e");
  const [integer = "0", fraction = ""] = coefficient.split(".");
  const digits = BigInt(integer + fraction);
  const power = Number(exponent) - fraction.length + 6;
  const divisor = power < 0 ? 10n ** BigInt(-power) : 1n;
  const magnitude = power < 0 ? (digits + divisor / 2n) / divisor : digits * 10n ** BigInt(power);
  const nanoseconds = value < 0 ? -magnitude : magnitude;
  const remainder = ((nanoseconds % 1_000_000_000n) + 1_000_000_000n) % 1_000_000_000n;
  const seconds = (nanoseconds - remainder) / 1_000_000_000n;
  const date = new Date(Number(seconds * 1000n));
  if (Number.isNaN(date.getTime())) throw new FsError("EIO", { message: "invalid filesystem timestamp" });
  return `${date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/u, `.${remainder.toString().padStart(9, "0")}`)} +0000`;
}

function epoch(milliseconds: number, precision: number): string {
  const value = available(milliseconds, "timestamp");
  const [coefficient = "0", exponent = "0"] = Math.abs(value).toString().split("e");
  const [integer = "0", decimal = ""] = coefficient.split(".");
  const digits = BigInt(integer + decimal);
  const places = Math.min(precision, 9);
  const scale = 10n ** BigInt(places);
  const power = Number(exponent) - decimal.length - 3 + places;
  const absolute = power < 0 ? digits / (10n ** BigInt(-power)) : digits * 10n ** BigInt(power);
  const fraction = absolute % scale;
  const seconds = value < 0 && fraction === 0n ? -Math.floor(value / 1000) : absolute / scale;
  const suffix = precision ? "." + fraction.toString().padStart(places, "0") + "0".repeat(precision - places) : "";
  return `${value < 0 ? "-" : ""}${seconds}${suffix}`;
}

function directive(format: string, start: number, bsd: boolean) {
  let index = start + 1;
  const flagsStart = index;
  while (index < format.length && "-+ #0".includes(format[index]!)) index++;
  const flags = format.slice(flagsStart, index);
  const widthStart = index;
  while (index < format.length && format[index]! >= "0" && format[index]! <= "9") index++;
  const width = format.slice(widthStart, index);
  let precision: string | undefined;
  if (format[index] === ".") {
    const precisionStart = ++index;
    while (index < format.length && format[index]! >= "0" && format[index]! <= "9") index++;
    precision = format.slice(precisionStart, index);
  }
  let code = format[index];
  if (bsd && code !== undefined) {
    const pair = format.slice(index, index + 2);
    const mapping: Record<string, string> = { z: "s", N: "n", m: "Y", a: "X", c: "Z", B: "W", Lp: "a", Sp: "A", u: "u", Su: "U", g: "g", Sg: "G", i: "i", l: "h", HT: "bsdType", Y: "bsdTarget", "%": "%" };
    const key = Object.hasOwn(mapping, pair) ? pair : code;
    if (!Object.hasOwn(mapping, key)) throw new UsageError(`unsupported BSD stat format: %${key}`);
    code = mapping[key]!;
    index += key.length - 1;
  }
  if (code === undefined) throw new UsageError("invalid stat format directive");
  const codePoint = code.charCodeAt(0);
  if (code !== "%" && !(codePoint >= 65 && codePoint <= 90) && !(codePoint >= 97 && codePoint <= 122)) {
    throw new UsageError("invalid stat format directive");
  }
  return { code, flags, length: index + 1 - start, precision, width };
}

function formatField(text: string, code: string, flags: string, width: number, precision: number | undefined, numeric: boolean, epoch: boolean): Uint8Array {
  if (numeric) {
    const nonzero = !/^0+$/u.test(text);
    if (!epoch && precision !== undefined) text = precision === 0 && !nonzero ? "" : text.padStart(precision, "0");
    if (flags.includes("#")) text = code === "a" ? (text.startsWith("0") ? text : `0${text}`) : (code === "f" || code === "D") && nonzero ? `0x${text}` : text;
    if (epoch && !text.startsWith("-") && (flags.includes("+") || flags.includes(" "))) text = `${flags.includes("+") ? "+" : " "}${text}`;
  }
  if (epoch && precision) {
    const decimal = text.indexOf(".");
    const integerWidth = width > precision + 2 && !flags.includes("-") ? width - precision - 1 : 0;
    const integer = formatField(text.slice(0, decimal), code, flags, integerWidth, undefined, true, false);
    const trailingWidth = integer.length < width && 1 < width - integer.length
      ? Math.abs(width - integer.length - 1 - precision) : 0;
    return concatBytes([integer, syncStatEncoder.encode(text.slice(decimal)), allocSpaces(trailingWidth)]);
  }
  const encoded = syncStatEncoder.encode(text);
  const bytes = !numeric && precision !== undefined ? encoded.subarray(0, precision) : encoded;
  const padding = Math.max(0, width - bytes.length);
  if (flags.includes("-")) return concatBytes([bytes, allocSpaces(padding)]);
  if (numeric && flags.includes("0") && (epoch || precision === undefined) && padding) {
    const prefix = /^[+ -]|^0x/u.exec(text)?.[0] ?? "";
    return syncStatEncoder.encode(prefix + "0".repeat(padding) + text.slice(prefix.length));
  }
  return concatBytes([allocSpaces(padding), bytes]);
}

async function render(context: CommandContext, path: string, name: string, stat: FileStat, format: string, escapes: boolean, limit: number, filesystem: boolean, terse: boolean, bsd: boolean): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const append = (text: string | Uint8Array) => {
    const chunk = typeof text === "string" ? new TextEncoder().encode(text) : text;
    bytes += chunk.byteLength;
    if (bytes > limit) throw new FsError("EFBIG", { message: "stat format output limit exceeded" });
    chunks.push(chunk);
  };
  for (let index = 0; index < format.length;) {
    context.signal.throwIfAborted();
    if (escapes && format[index] === "\\") {
      const named: Record<string, string> = { a: "\x07", b: "\b", e: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", "\"": "\"" };
      const code = format[index + 1] ?? "";
      if (Object.hasOwn(named, code)) {
        append(named[code]!);
        index += 2;
        continue;
      }
      const radix = code === "x" ? 16 : 8;
      const start = index + (radix === 16 ? 2 : 1);
      const end = Math.min(format.length, start + (radix === 16 ? 2 : 3));
      let offset = start;
      let value = 0;
      while (offset < end) {
        const digit = "0123456789abcdef".indexOf(format[offset]!.toLowerCase());
        if (digit < 0 || digit >= radix) break;
        value = value * radix + digit;
        offset++;
      }
      if (offset === start) { append(format[index++]!); continue; }
      append(Uint8Array.of(value));
      index = offset;
      continue;
    }
    if (format[index] !== "%") {
      const point = String.fromCodePoint(format.codePointAt(index)!);
      append(point); index += point.length; continue;
    }
    const parsed = directive(format, index, bsd);
    index += parsed.length;
    const { code, flags } = parsed;
    const width = Number(parsed.width || 0);
    if (!Number.isSafeInteger(width) || width > limit) throw new FsError("EFBIG", { message: "stat format width limit exceeded" });
    const epochCode = !filesystem && ["X", "Y", "Z", "W"].includes(code);
    const precision = parsed.precision === undefined ? undefined : Number(parsed.precision || (epochCode ? 9 : 0));
    if (precision !== undefined && (!Number.isSafeInteger(precision) || precision > limit)) throw new FsError("EFBIG", { message: "stat format precision limit exceeded" });
    if (code === "%" && parsed.length !== 2) throw new UsageError("invalid stat format directive");
    if (filesystem) {
      let text: string;
      if (code === "n") text = name;
      else if (code === "%") text = "%";
      else if (code === "T") {
        if (stat.filesystemType === undefined) throw new FsError("ENOTSUP", { syscall: "stat", message: "filesystem does not expose its type" });
        if (typeof stat.filesystemType !== "string" || stat.filesystemType.length === 0) throw new FsError("EIO", { syscall: "stat", message: "invalid filesystem type" });
        text = stat.filesystemType;
      } else throw new FsError("ENOTSUP", { message: `unsupported filesystem stat format: %${code}` });
      append(formatField(text, code, flags, width, precision, false, false));
      continue;
    }
    let text: string;
    let linkText: string | undefined;
    let numeric = false;
    if (["a", "A", "f"].includes(code)) available(stat.mode, "mode");
    const times: Record<string, number | undefined> = { X: stat.atimeMs, Y: stat.mtimeMs, Z: stat.ctimeMs, W: stat.birthtimeMs };
    if (Object.hasOwn(times, code)) { text = terse && times[code] === undefined ? "?" : epoch(available(times[code], code), precision ?? 0); numeric = text !== "?"; }
    else if (code === "bsdType") text = stat.type === "directory" ? "Directory" : stat.type === "symlink" ? "Symbolic Link" : stat.type === "character" ? "Character Device" : "Regular File";
    else if (code === "n") text = name;
    else if (code === "bsdTarget") {
      text = "";
      if (stat.type === "symlink") {
        if (!context.fs.readlink) throw new FsError("ENOTSUP", { syscall: "readlink", path });
        text = await context.fs.readlink(path, { signal: context.signal });
      }
    }
    else if (code === "N") {
      text = quoted(name, context.env.QUOTING_STYLE);
      if (stat.type === "symlink") {
        if (!context.fs.readlink) throw new FsError("ENOTSUP", { syscall: "readlink", path });
        linkText = quoted(await context.fs.readlink(path, { signal: context.signal }), context.env.QUOTING_STYLE);
      }
    } else if (code === "%") text = "%";
    else if (code === "A") text = permissionString(stat.mode, stat.type);
    else if (code === "U") text = available(stat.uid, "u") === 0 ? "root" : String(stat.uid);
    else if (code === "G") text = available(stat.gid, "g") === 0 ? "root" : String(stat.gid);
    else if (code === "m") text = "/";
    else if (code === "F") text = stat.type === "directory" ? "directory" : stat.type === "symlink" ? "symbolic link" : stat.type === "character" ? "character special file" : stat.size === 0 ? "regular empty file" : "regular file";
    else if (["x", "y", "z", "w"].includes(code)) {
      const value = times[code.toUpperCase()];
      text = code === "w" && value === undefined ? "-" : timestamp(available(value, code));
    } else {
      const fields: Record<string, number | undefined> = { s: stat.size, a: stat.mode & 0o7777, f: stat.mode, i: stat.ino, h: stat.nlink, u: stat.uid, g: stat.gid, d: stat.dev, D: stat.dev,
        B: 512, b: stat.allocatedBytes === undefined ? undefined : Math.ceil(stat.allocatedBytes / 512),
        o: stat.ioBlockSize, t: stat.rdevMajor, T: stat.rdevMinor };
      if (!Object.hasOwn(fields, code)) throw new FsError("ENOTSUP", { message: `unsupported stat format: %${code}` });
      const value = fields[code];
      text = terse && value === undefined ? "?" : available(value, code).toString(code === "a" ? 8 : ["f", "D", "t", "T"].includes(code) ? 16 : 10);
      numeric = text !== "?";
    }
    append(formatField(text, code, flags, width, precision, numeric, epochCode));
    if (linkText !== undefined) {
      append(" -> ");
      append(formatField(linkText, code, flags, width, precision, false, false));
    }
  }
  return concatBytes(chunks);
}

export function createStatCommand(configuration: MetadataCommandsOptions = {}) {
  const configured = settings(configuration);
  return metadataCommand("stat", async context => {
    const budget = new MetadataBudget(context, configured.limits);
    const parsed = parse(context.args);
    let exitCode = 0;
    for (const name of parsed.paths) {
      await budget.step();
      try {
        const path = pathOf(context, name);
        const stat = await context.fs[parsed.follow || parsed.filesystem ? "stat" : "lstat"](path, { signal: context.signal });
        const terse = parsed.terse && parsed.format === undefined;
        if (terse && parsed.filesystem) throw new FsError("ENOTSUP", { message: "filesystem terse stat is unsupported" });
        const format = parsed.format ?? (parsed.filesystem ? "  File: %n\n  Type: %T" : terse
          ? "%n %s %b %f %u %g %D %i %h %t %T %X %Y %Z %W %o"
          : "  File: %N\n  Size: %s\tType: %F\n  Mode: %a (%A)\nAccess: %x\nModify: %y\nChange: %z\n Birth: %w");
        const text = await render(context, path, name, stat, format, parsed.printf, configured.limits.maxOutputBytes, parsed.filesystem, terse, parsed.bsd);
        await budget.output(parsed.printf ? text : concatBytes([text, Uint8Array.of(10)]));
      } catch (error) {
        context.signal.throwIfAborted();
        if (codeOf(error) === "EFBIG") throw error;
        await diagnostic(context, error); exitCode = 1;
      }
    }
    return { exitCode };
  });
}

export interface SyncStatInfo extends FileStat {
  readonly target?: string;
}

const syncStatDecoder = new TextDecoder("utf-8", { fatal: false });

function renderSync(
  path: string,
  name: string,
  stat: SyncStatInfo,
  format: string,
  escapes: boolean,
  limit: number,
  filesystem: boolean,
  terse: boolean,
  quotingStyle: string | undefined,
  bsd: boolean,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const append = (text: string | Uint8Array) => {
    const chunk = typeof text === "string" ? new TextEncoder().encode(text) : text;
    bytes += chunk.byteLength;
    if (bytes > limit) throw new FsError("EFBIG", { message: "stat format output limit exceeded" });
    chunks.push(chunk);
  };
  for (let index = 0; index < format.length;) {
    if (escapes && format[index] === "\\") {
      const named: Record<string, string> = { a: "\x07", b: "\b", e: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", "\"": "\"" };
      const code = format[index + 1] ?? "";
      if (Object.hasOwn(named, code)) {
        append(named[code]!);
        index += 2;
        continue;
      }
      const radix = code === "x" ? 16 : 8;
      const start = index + (radix === 16 ? 2 : 1);
      const end = Math.min(format.length, start + (radix === 16 ? 2 : 3));
      let offset = start;
      let value = 0;
      while (offset < end) {
        const digit = "0123456789abcdef".indexOf(format[offset]!.toLowerCase());
        if (digit < 0 || digit >= radix) break;
        value = value * radix + digit;
        offset++;
      }
      if (offset === start) { append(format[index++]!); continue; }
      append(Uint8Array.of(value));
      index = offset;
      continue;
    }
    if (format[index] !== "%") {
      const point = String.fromCodePoint(format.codePointAt(index)!);
      append(point); index += point.length; continue;
    }
    const parsed = directive(format, index, bsd);
    index += parsed.length;
    const { code, flags } = parsed;
    const width = Number(parsed.width || 0);
    if (!Number.isSafeInteger(width) || width > limit) throw new FsError("EFBIG", { message: "stat format width limit exceeded" });
    const epochCode = !filesystem && ["X", "Y", "Z", "W"].includes(code);
    const precision = parsed.precision === undefined ? undefined : Number(parsed.precision || (epochCode ? 9 : 0));
    if (precision !== undefined && (!Number.isSafeInteger(precision) || precision > limit)) throw new FsError("EFBIG", { message: "stat format precision limit exceeded" });
    if (code === "%" && parsed.length !== 2) throw new UsageError("invalid stat format directive");
    if (filesystem) {
      let text: string;
      if (code === "n") text = name;
      else if (code === "%") text = "%";
      else if (code === "T") {
        if (stat.filesystemType === undefined) throw new FsError("ENOTSUP", { syscall: "stat", message: "filesystem does not expose its type" });
        if (typeof stat.filesystemType !== "string" || stat.filesystemType.length === 0) throw new FsError("EIO", { syscall: "stat", message: "invalid filesystem type" });
        text = stat.filesystemType;
      } else throw new FsError("ENOTSUP", { message: `unsupported filesystem stat format: %${code}` });
      append(formatField(text, code, flags, width, precision, false, false));
      continue;
    }
    let text: string;
    let linkText: string | undefined;
    let numeric = false;
    if (["a", "A", "f"].includes(code)) available(stat.mode, "mode");
    const times: Record<string, number | undefined> = { X: stat.atimeMs, Y: stat.mtimeMs, Z: stat.ctimeMs, W: stat.birthtimeMs };
    if (Object.hasOwn(times, code)) { text = terse && times[code] === undefined ? "?" : epoch(available(times[code], code), precision ?? 0); numeric = text !== "?"; }
    else if (code === "bsdType") text = stat.type === "directory" ? "Directory" : stat.type === "symlink" ? "Symbolic Link" : stat.type === "character" ? "Character Device" : "Regular File";
    else if (code === "n") text = name;
    else if (code === "bsdTarget") {
      if (stat.type === "symlink" && stat.target === undefined) throw new FsError("ENOTSUP", { syscall: "readlink", path });
      text = stat.type === "symlink" ? stat.target! : "";
    }
    else if (code === "N") {
      text = quoted(name, quotingStyle);
      if (stat.type === "symlink") {
        if (stat.target === undefined) throw new FsError("ENOTSUP", { syscall: "readlink", path });
        linkText = quoted(stat.target, quotingStyle);
      }
    } else if (code === "%") text = "%";
    else if (code === "A") text = permissionString(stat.mode, stat.type);
    else if (code === "U") text = available(stat.uid, "u") === 0 ? "root" : String(stat.uid);
    else if (code === "G") text = available(stat.gid, "g") === 0 ? "root" : String(stat.gid);
    else if (code === "m") text = "/";
    else if (code === "F") text = stat.type === "directory" ? "directory" : stat.type === "symlink" ? "symbolic link" : stat.type === "character" ? "character special file" : stat.size === 0 ? "regular empty file" : "regular file";
    else if (["x", "y", "z", "w"].includes(code)) {
      const value = times[code.toUpperCase()];
      text = code === "w" && value === undefined ? "-" : timestamp(available(value, code));
    } else {
      const fields: Record<string, number | undefined> = { s: stat.size, a: stat.mode & 0o7777, f: stat.mode, i: stat.ino, h: stat.nlink, u: stat.uid, g: stat.gid, d: stat.dev, D: stat.dev,
        B: 512, b: stat.allocatedBytes === undefined ? undefined : Math.ceil(stat.allocatedBytes / 512),
        o: stat.ioBlockSize, t: stat.rdevMajor, T: stat.rdevMinor };
      if (!Object.hasOwn(fields, code)) throw new FsError("ENOTSUP", { message: `unsupported stat format: %${code}` });
      const value = fields[code];
      text = terse && value === undefined ? "?" : available(value, code).toString(code === "a" ? 8 : ["f", "D", "t", "T"].includes(code) ? 16 : 10);
      numeric = text !== "?";
    }
    append(formatField(text, code, flags, width, precision, numeric, epochCode));
    if (linkText !== undefined) {
      append(" -> ");
      append(formatField(linkText, code, flags, width, precision, false, false));
    }
  }
  return concatBytes(chunks);
}

function resolveSyncStatPath(cwd: string, target: string): string {
  const raw = target.startsWith("/") ? target : (cwd.endsWith("/") ? cwd + target : `${cwd}/${target}`);
  const parts = raw.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return "/" + stack.join("/");
}

export function evalSyncStat(
  args: readonly string[],
  cwd: string,
  quotingStyle: string | undefined,
  inspectStat: (absPath: string, follow: boolean) => SyncStatInfo | undefined,
): string | undefined {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch {
    return undefined;
  }
  const outChunks: Uint8Array[] = [];
  for (const name of parsed.paths) {
    if (!name) return undefined;
    const abs = resolveSyncStatPath(cwd, name);
    const stat = inspectStat(abs, parsed.follow || parsed.filesystem);
    if (!stat) return undefined;
    const terse = parsed.terse && parsed.format === undefined;
    if (terse && parsed.filesystem) return undefined;
    const format = parsed.format ?? (parsed.filesystem ? "  File: %n\n  Type: %T" : terse
      ? "%n %s %b %f %u %g %D %i %h %t %T %X %Y %Z %W %o"
      : "  File: %N\n  Size: %s\tType: %F\n  Mode: %a (%A)\nAccess: %x\nModify: %y\nChange: %z\n Birth: %w");
    try {
      const rendered = renderSync(abs, name, stat, format, parsed.printf, 262144, parsed.filesystem, terse, quotingStyle, parsed.bsd);
      outChunks.push(parsed.printf ? rendered : concatBytes([rendered, Uint8Array.of(10)]));
    } catch {
      return undefined;
    }
  }
  return syncStatDecoder.decode(concatBytes(outChunks));
}
