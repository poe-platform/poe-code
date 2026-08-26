import { FsError, type CommandContext, type FileStat } from "../../contracts/index.js";
import { codeOf, diagnostic, pathOf, requireOperands, UsageError } from "../internal.js";
import { MetadataBudget, metadataCommand, permissionString, settings, type MetadataCommandsOptions } from "./internal.js";

function parse(args: readonly string[]) {
  let follow = false;
  let format: string | undefined;
  let printf = false;
  let literal = false;
  const paths: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (literal || argument === "-" || !argument.startsWith("-")) paths.push(argument);
    else if (argument === "--") literal = true;
    else if (argument === "--dereference") follow = true;
    else if (argument === "--format" || argument.startsWith("--format=") || argument === "--printf" || argument.startsWith("--printf=")) {
      printf = argument.startsWith("--printf");
      format = argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : args[++index];
      if (format === undefined) throw new UsageError(`missing format for '${argument}'`);
    } else if (!argument.startsWith("--")) {
      for (let offset = 1; offset < argument.length; offset++) {
        if (argument[offset] === "L") follow = true;
        else if (argument[offset] === "c") {
          format = argument.slice(offset + 1) || args[++index];
          if (format === undefined) throw new UsageError("missing format for '-c'");
          printf = false;
          break;
        } else throw new UsageError(`unrecognized option '${argument}'`);
      }
    } else throw new UsageError(`unrecognized option '${argument}'`);
  }
  requireOperands(paths);
  return { follow, format, printf, paths };
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
  const date = new Date(available(milliseconds, "timestamp"));
  if (Number.isNaN(date.getTime())) throw new FsError("EIO", { message: "invalid filesystem timestamp" });
  return `${date.toISOString().replace("T", " ").replace("Z", "")} +0000`;
}

function epoch(milliseconds: number, precision: number): string {
  if (precision > 3) throw new FsError("ENOTSUP", { message: "stat timestamps support at most millisecond precision" });
  const scale = 10 ** precision;
  const scaled = Math.floor(available(milliseconds, "timestamp") / 1000 * scale);
  const absolute = Math.abs(scaled);
  return `${scaled < 0 ? "-" : ""}${Math.floor(absolute / scale)}${precision ? "." + (absolute % scale).toString().padStart(precision, "0") : ""}`;
}

async function render(context: CommandContext, path: string, name: string, stat: FileStat, format: string, escapes: boolean, limit: number): Promise<Uint8Array> {
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
      const escape = /^\\(?:([abefnrtv\\])|x([0-9a-fA-F]{1,2})|([0-7]{1,3}))/u.exec(format.slice(index));
      if (!escape) { append(format[index++]!); continue; }
      const named: Record<string, string> = { a: "\x07", b: "\b", e: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\" };
      append(escape[1] ? named[escape[1]]! : Uint8Array.of(Number.parseInt(escape[2] ?? escape[3]!, escape[2] ? 16 : 8)));
      index += escape[0].length;
      continue;
    }
    if (format[index] !== "%") {
      const point = String.fromCodePoint(format.codePointAt(index)!);
      append(point); index += point.length; continue;
    }
    const match = /^%([-+ #0]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/u.exec(format.slice(index));
    if (!match) throw new UsageError("invalid stat format directive");
    index += match[0].length;
    const flags = match[1]!;
    const width = Number(match[2] || 0);
    if (!Number.isSafeInteger(width) || width > limit) throw new FsError("EFBIG", { message: "stat format width limit exceeded" });
    const precision = match[3] === undefined ? undefined : Number(match[3] || 9);
    const code = match[4]!;
    let text: string;
    let numeric = false;
    if (["a", "A", "f"].includes(code)) available(stat.mode, "mode");
    const times: Record<string, number | undefined> = { X: stat.atimeMs, Y: stat.mtimeMs, Z: stat.ctimeMs, W: stat.birthtimeMs };
    if (Object.hasOwn(times, code)) { text = epoch(available(times[code], code), precision ?? 0); numeric = true; }
    else if (code === "n") text = name;
    else if (code === "N") {
      text = quoted(name, context.env.QUOTING_STYLE);
      if (stat.type === "symlink") {
        if (!context.fs.readlink) throw new FsError("ENOTSUP", { syscall: "readlink", path });
        text += ` -> ${quoted(await context.fs.readlink(path, { signal: context.signal }), context.env.QUOTING_STYLE)}`;
      }
    } else if (code === "%") text = "%";
    else if (code === "A") text = permissionString(stat.mode, stat.type);
    else if (code === "F") text = stat.type === "directory" ? "directory" : stat.type === "symlink" ? "symbolic link" : stat.size === 0 ? "regular empty file" : "regular file";
    else if (["x", "y", "z", "w"].includes(code)) {
      const value = times[code.toUpperCase()];
      text = code === "w" && value === undefined ? "-" : timestamp(available(value, code));
    } else {
      const fields: Record<string, number | undefined> = { s: stat.size, a: stat.mode & 0o7777, f: stat.mode, i: stat.ino, h: stat.nlink, u: stat.uid, g: stat.gid, d: stat.dev, D: stat.dev };
      if (!Object.hasOwn(fields, code)) throw new FsError("ENOTSUP", { message: `unsupported stat format: %${code}` });
      const value = available(fields[code], code);
      text = value.toString(code === "a" ? 8 : code === "f" || code === "D" ? 16 : 10);
      numeric = true;
    }
    if (precision !== undefined && !Object.hasOwn(times, code)) throw new FsError("ENOTSUP", { message: "stat precision is only supported for epoch timestamps" });
    if (numeric && flags.includes("#")) text = code === "a" ? (text.startsWith("0") ? text : `0${text}`) : code === "f" || code === "D" ? `0x${text}` : text;
    if (numeric && !text.startsWith("-") && (flags.includes("+") || flags.includes(" "))) text = `${flags.includes("+") ? "+" : " "}${text}`;
    const padding = Math.max(0, width - text.length);
    if (flags.includes("-")) text += " ".repeat(padding);
    else if (numeric && flags.includes("0") && padding) {
      const prefix = /^[+ -]|^0x/u.exec(text)?.[0] ?? "";
      text = prefix + "0".repeat(padding) + text.slice(prefix.length);
    } else text = " ".repeat(padding) + text;
    append(text);
  }
  return Buffer.concat(chunks);
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
        const stat = await context.fs[parsed.follow ? "stat" : "lstat"](path, { signal: context.signal });
        const format = parsed.format ?? "  File: %N\n  Size: %s\tType: %F\n  Mode: %a (%A)\nAccess: %x\nModify: %y\nChange: %z\n Birth: %w";
        const text = await render(context, path, name, stat, format, parsed.printf, configured.limits.maxOutputBytes);
        await budget.output(parsed.printf ? text : Buffer.concat([text, Uint8Array.of(10)]));
      } catch (error) {
        context.signal.throwIfAborted();
        if (codeOf(error) === "EFBIG") throw error;
        await diagnostic(context, error); exitCode = 1;
      }
    }
    return { exitCode };
  });
}
