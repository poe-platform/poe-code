import { collectNetworkBytes as collectBytes } from "./shared.js";
import { type CommandContext } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
import { flags, longValues, parseArguments, values, type CurlArguments } from "./args.js";
import { CurlError, type NetworkLimits } from "./types.js";
import { withSignal } from "./shared.js";

function whitespace(character: string): boolean {
  return " \t\r\n\v\f".includes(character);
}

/** curl config is a line-oriented option format, not shell source. */
function configArguments(text: string): string[] {
  const args: string[] = [];
  for (const line of text.split("\n")) {
    let offset = 0;
    while (offset < line.length && whitespace(line[offset]!)) offset++;
    if (offset === line.length || line[offset] === "#") continue;
    const start = offset;
    const dashed = line[offset] === "-";
    while (offset < line.length && !whitespace(line[offset]!) && (dashed || !"=:".includes(line[offset]!))) offset++;
    const option = line.slice(start, offset);
    args.push(dashed ? option : `--${option}`);
    while (offset < line.length && whitespace(line[offset]!)) offset++;
    if (!dashed && "=:".includes(line[offset] ?? "\0")) offset++;
    while (offset < line.length && whitespace(line[offset]!)) offset++;
    if (offset === line.length) continue;
    let value = "";
    if (line[offset] === '"') {
      offset++;
      let closed = false;
      while (offset < line.length) {
        let character = line[offset++]!;
        if (character === '"') { closed = true; break; }
        if (character === "\\" && offset < line.length) {
          character = line[offset++]!;
          character = ({ n: "\n", r: "\r", t: "\t", v: "\v" } as Record<string, string>)[character] ?? character;
        }
        value += character;
      }
      if (!closed) throw new CurlError(2, "Unterminated config string");
      if (line.slice(offset).trim()) throw new CurlError(2, "Unexpected config string suffix");
    } else value = line.slice(offset).trimEnd();
    args.push(value);
  }
  return args;
}

function variableName(name: string): boolean {
  return name.length > 0 && [...name].every(character =>
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".includes(character));
}

/** Resolve explicit config, variable and -H/--header @VFS-file or @- inputs in option order. */
export async function parseCurlInput(context: CommandContext, limits: NetworkLimits): Promise<CurlArguments> {
  const variables = new Map<string, Buffer>();
  const output: string[] = [];
  let inputBytes = 0;
  let outputBytes = 0;
  let optionCount = 0;
  const admit = (value: string): string => {
    inputBytes += Buffer.byteLength(value);
    if (inputBytes > limits.maxBufferBytes) throw new CurlError(2, "Curl input exceeds host buffer limit");
    return value;
  };
  const append = (value: string): void => {
    outputBytes += Buffer.byteLength(value);
    if (outputBytes > limits.maxBufferBytes) throw new CurlError(2, "Expanded arguments exceed host buffer limit");
    output.push(value);
  };
  const read = async (file: string): Promise<Buffer> => {
    try {
      const maxBytes = limits.maxBufferBytes - inputBytes;
      const bytes = file === "-" ? await collectBytes(context.stdin, { signal: context.signal, maxBytes })
        : await withSignal(() => context.fs.readFile(pathOf(context, file), { signal: context.signal, ...(Number.isFinite(maxBytes) ? { maxBytes } : {}) }), context.signal);
      context.signal.throwIfAborted();
      inputBytes += bytes.length;
      if (inputBytes > limits.maxBufferBytes) throw new CurlError(2, "Curl input exceeds host buffer limit");
      return Buffer.from(bytes);
    } catch (error) {
      context.signal.throwIfAborted();
      if (error instanceof CurlError) throw error;
      throw new CurlError(26, "Failed to read virtual curl input");
    }
  };
  const expand = (value: string): string => {
    let result = "";
    let size = 0;
    let offset = 0;
    const appendPiece = (piece: string): void => {
      size += Buffer.byteLength(piece);
      if (size > limits.maxBufferBytes) throw new CurlError(2, "Variable expansion exceeds host buffer limit");
      result += piece;
    };
    while (offset < value.length) {
      const start = value.indexOf("{{", offset);
      if (start < 0) { appendPiece(value.slice(offset)); break; }
      appendPiece(value.slice(offset, start));
      const end = value.indexOf("}}", start + 2);
      if (end < 0) { appendPiece(value.slice(start)); break; }
      const [name, ...functions] = value.slice(start + 2, end).split(":");
      if (!variableName(name!)) throw new CurlError(2, "Invalid expansion variable");
      let bytes = variables.get(name!) ?? Buffer.alloc(0);
      for (const functionName of functions) {
        const requireSpace = (length: number): void => {
          if (length > limits.maxBufferBytes) throw new CurlError(2, "Variable transformation exceeds host buffer limit");
        };
        switch (functionName) {
          case "trim": {
            let start = 0, end = bytes.length;
            while (start < end && whitespace(String.fromCharCode(bytes[start]!))) start++;
            while (end > start && whitespace(String.fromCharCode(bytes[end - 1]!))) end--;
            bytes = bytes.subarray(start, end); break;
          }
          case "json": {
            requireSpace(bytes.length * 6);
            bytes = Buffer.from(JSON.stringify(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).slice(1, -1)); break;
          }
          case "url": {
            requireSpace(bytes.length * 3);
            let encoded = "";
            for (const byte of bytes) {
              const character = String.fromCharCode(byte);
              encoded += "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~".includes(character)
                ? character : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
            }
            bytes = Buffer.from(encoded); break;
          }
          case "b64": requireSpace(Math.ceil(bytes.length / 3) * 4); bytes = Buffer.from(bytes.toString("base64")); break;
          default: throw new CurlError(2, "Unsupported variable expansion function");
        }
      }
      let replacement: string;
      try { replacement = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new CurlError(2, "Binary variable requires url or b64 expansion"); }
      if (replacement.includes("\0")) throw new CurlError(2, "Variable expansion contains NUL");
      appendPiece(replacement);
      offset = end + 2;
    }
    return result;
  };
  const define = async (value: string): Promise<void> => {
    const fromEnv = value.startsWith("%");
    const spec = fromEnv ? value.slice(1) : value;
    let delimiter = spec.indexOf("=");
    const at = spec.indexOf("@");
    if (delimiter < 0 || at >= 0 && at < delimiter) delimiter = at;
    const name = delimiter < 0 ? spec : spec.slice(0, delimiter);
    if (!variableName(name)) throw new CurlError(2, "Invalid variable name");
    let content: Buffer | undefined = fromEnv && context.env[name] !== undefined ? Buffer.from(admit(context.env[name]!)) : undefined;
    if (content === undefined) {
      if (delimiter < 0) {
        if (fromEnv) throw new CurlError(2, "Required environment variable is unset");
        content = Buffer.alloc(0);
      } else content = spec[delimiter] === "@" ? await read(spec.slice(delimiter + 1)) : Buffer.from(admit(spec.slice(delimiter + 1)));
    }
    variables.set(name, content);
  };
  let ended = false;
  const visit = async (args: readonly string[], depth: number): Promise<void> => {
    if (depth > 16) throw new CurlError(2, "Config nesting exceeds host limit");
    for (let index = 0; index < args.length; index++) {
      context.signal.throwIfAborted();
      if (++optionCount > limits.maxBufferBytes) throw new CurlError(2, "Curl option count exceeds host limit");
      const argument = args[index]!;
      if (ended || argument === "-" || !argument.startsWith("-")) { append(argument); continue; }
      if (argument === "--") { ended = true; append(argument); continue; }
      const apply = async (name: string, attached?: string): Promise<void> => {
        const expanded = name.startsWith("expand-");
        const base = expanded ? name.slice(7) : name;
        const takesValue = longValues.has(base) || base === "config" || base === "variable";
        if (expanded && (!longValues.has(base))) throw new CurlError(2, "Unsupported expand option");
        if (!takesValue) { if (attached !== undefined) throw new CurlError(2, "Unexpected option argument"); append(`--${name}`); return; }
        const value = attached ?? args[++index];
        if (value === undefined) throw new CurlError(2, "Option requires an argument");
        const resolved = expanded ? expand(value) : value;
        if (base === "config") await visit(configArguments((await read(resolved)).toString("utf8")), depth + 1);
        else if (base === "variable") await define(resolved);
        else if (base === "header" && resolved.startsWith("@")) {
          const text = (await read(resolved.slice(1))).toString("utf8");
          for (const raw of text.split("\n")) {
            context.signal.throwIfAborted();
            const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
            if (!line || line.startsWith("#")) continue;
            append("--header");
            append(line);
          }
        }
        else { append(`--${base}`); append(resolved); }
      };
      if (argument.startsWith("--")) {
        const equals = argument.indexOf("=");
        await apply(argument.slice(2, equals < 0 ? undefined : equals), equals < 0 ? undefined : argument.slice(equals + 1));
      } else {
        for (let offset = 1; offset < argument.length; offset++) {
          const short = argument[offset]!;
          const name = short === "K" ? "config" : values[short];
          if (name) { await apply(name, argument.slice(offset + 1) || undefined); break; }
          if (!flags[short]) throw new CurlError(2, "Unsupported curl option");
          await apply(flags[short]);
        }
      }
    }
  };
  await visit(context.args, 0);
  return parseArguments(output, limits);
}
