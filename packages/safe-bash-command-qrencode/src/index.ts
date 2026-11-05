import {
  collectBytes,
  getCommandArguments,
  resolvePath,
  writeBytes,
  writeFileOutput,
  type CommandContext,
  type CommandDefinition,
  type VirtualShellPlugin
} from "safe-bash-contracts";
import { isFsError } from "safe-bash-contracts/errors";
import { yieldTurn, drainCooperativeSteps } from "safe-bash-contracts/yield";
import {
  QrEncodingError,
  encodeQrSteps,
  kanjiValue,
  type EncodeOptions,
  type QrLevel,
  type QrSymbol
} from "./encoder.js";
import { outputTypes, renderQr, type RenderOptions } from "./render.js";

export interface QrencodeLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxMemoryBytes: number;
}
export interface QrencodeCommandsOptions {
  readonly limits?: Partial<QrencodeLimits>;
  readonly replace?: boolean;
}
export type QrencodeCommandOptions = QrencodeCommandsOptions;
export {
  encodeQr,
  reedSolomon,
  type EncodeOptions,
  type QrLevel,
  type QrSymbol
} from "./encoder.js";

const help = `Usage: qrencode [OPTION]... [STRING]
Generate QR codes from a string, stdin, or a virtual file.
  -o, --output FILE       Virtual output file (- for stdout)
  -r, --read-from FILE    Read input from a virtual file
  -t, --type TYPE         PNG, PNG32, SVG, EPS, ASCII, ASCIIi,
                         UTF8, UTF8i, ANSI, ANSI256, ANSIUTF8, ANSIUTF8i, ANSI256UTF8
  -s, --size N            Module pixel size (default 3)
  -m, --margin N          Quiet zone (default 4, Micro QR 2)
  -l, --level L|M|Q|H     Error correction (default L)
  -v, --symversion N      Minimum version (0 auto, QR 1..40, Micro 1..4)
  -d, --dpi N            PNG resolution (default 72)
  -8, --8bit             Encode raw bytes
  -k, --kanji            Interpret Shift-JIS pairs as Kanji
  -i, --ignorecase       Fold ASCII lowercase to uppercase
  -S, --structured       Structured append (requires -v and -o)
  -M, --micro            Generate Micro QR
      --strict-version   Fail instead of increasing version
      --foreground=RRGGBB[AA]  Foreground color
      --background=RRGGBB[AA]  Background color
  -h, --help             Show help
`;

function integer(value: string, min: number, max = 0x7fffffff): number {
  if (!value.length || [...value].some((c) => c < "0" || c > "9"))
    throw new Error(`Invalid number: ${value}`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new Error(`Number out of range: ${value}`);
  return result;
}
function color(value: string): number[] {
  if (
    (value.length !== 6 && value.length !== 8) ||
    [...value.toLowerCase()].some((c) => !"0123456789abcdef".includes(c))
  )
    throw new Error("Colors must be RRGGBB or RRGGBBAA");
  return [0, 2, 4, 6].map((i) => (i >= value.length ? 255 : parseInt(value.slice(i, i + 2), 16)));
}
function parse(args: readonly string[]) {
  let output: string | undefined, input: string | undefined, operand: number | undefined;
  let type: RenderOptions["type"] = "PNG",
    size = 3,
    margin: number | undefined,
    dpi = 72;
  let level: QrLevel = "L",
    version = 0,
    byte = false,
    kanji = false,
    ignorecase = false,
    structured = false,
    micro = false,
    strict = false;
  let foreground = [0, 0, 0, 255],
    background = [255, 255, 255, 255],
    end = false;
  let assistance: string | undefined;
  let shortOffset = 1;
  const aliases: Record<string, string> = {
    output: "o",
    "read-from": "r",
    type: "t",
    size: "s",
    margin: "m",
    dpi: "d",
    level: "l",
    symversion: "v",
    structured: "S",
    kanji: "k",
    casesensitive: "c",
    ignorecase: "i",
    "8bit": "8",
    micro: "M",
    help: "h",
    version: "V"
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!end && arg === "--") {
      end = true;
      continue;
    }
    if (end || !arg.startsWith("-") || arg === "-") {
      operand ??= i;
      continue;
    }
    const long = arg.startsWith("--"),
      eq = long ? arg.indexOf("=") : -1;
    const name = long ? arg.slice(2, eq < 0 ? undefined : eq) : arg[shortOffset]!;
    const key = aliases[name] ?? name;
    let attached = long
      ? eq < 0
        ? undefined
        : arg.slice(eq + 1)
      : arg.length > shortOffset + 1
        ? arg.slice(shortOffset + 1)
        : undefined;
    if (!["o", "r", "t", "s", "m", "d", "l", "v", "foreground", "background"].includes(key)) {
      if (long && attached !== undefined) throw new Error(`Unexpected option value: ${arg}`);
      if (key === "h" || key === "V") {
        assistance = key === "h" ? help : "qrencode version 4.1.1\nCopyright (C) 2006-2017 Kentaro Fukuchi\n";
        break;
      } else if (key === "8") byte = true;
      else if (key === "k") kanji = true;
      else if (key === "i") ignorecase = true;
      else if (key === "c") ignorecase = false;
      else if (key === "S") structured = true;
      else if (key === "M") micro = true;
      else if (key === "strict-version") strict = true;
      else if (!long) return { invalidShortOption: { index: i, offset: shortOffset } };
      else throw new Error(`Unknown option: ${arg}`);
      if (!long && ++shortOffset < arg.length) i--;
      else shortOffset = 1;
      continue;
    }
    shortOffset = 1;
    const valueOffset = attached === undefined ? 0 : arg.length - attached.length;
    attached ??= args[++i];
    if (attached === undefined) throw new Error(`Missing value for ${arg}`);
    if (key === "o") output = attached;
    else if (key === "r") input = attached;
    else if (key === "t") {
      const selected = outputTypes.find(format => format.toLowerCase() === attached.toLowerCase());
      if (!selected) return { invalidValue: { label: "image type", index: i, offset: valueOffset } };
      type = selected;
    } else if (key === "s") size = integer(attached, 1);
    else if (key === "m") margin = integer(attached, 0);
    else if (key === "d") dpi = integer(attached, 1, 109093169);
    else if (key === "v") version = attached === "auto" ? 0 : integer(attached, 0, 40);
    else if (key === "l") {
      const selected = attached[0]?.toUpperCase();
      if (selected !== "L" && selected !== "M" && selected !== "Q" && selected !== "H")
        return { invalidValue: { label: "level", index: i, offset: valueOffset } };
      level = selected;
    } else if (key === "foreground") foreground = color(attached);
    else background = color(attached);
  }
  return {
    output,
    input,
    operand,
    ignorecase,
    structured,
    assistance,
    encode: { version, level, byte, kanji, micro, strict },
    render: { type, size, margin: margin ?? (micro ? 2 : 4), dpi, foreground, background }
  };
}

async function* symbols(
  data: Uint8Array,
  options: EncodeOptions,
  structured: boolean,
  signal: AbortSignal
): AsyncGenerator<QrSymbol> {
  await yieldTurn(signal);
  if (!structured) {
    yield await drainCooperativeSteps(encodeQrSteps(data, options), signal);
    return;
  }
  try {
    yield await drainCooperativeSteps(encodeQrSteps(data, { ...options, strict: true }), signal);
    return;
  } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof QrEncodingError))
      throw error; /* Split a payload that does not fit one symbol. */
  }
  let parity = 0;
  for (const value of data) parity ^= value;
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; ) {
    await yieldTurn(signal);
    if (parts.length === 16) throw new Error("Structured append exceeds 16 symbols");
    let low = 0,
      high = Math.min(data.length - offset, 7089);
    while (low < high) {
      const length = Math.ceil((low + high) / 2);
      try {
        await drainCooperativeSteps(
          encodeQrSteps(data.subarray(offset, offset + length), {
            ...options,
            strict: true,
            append: [0, 16, parity]
          }),
          signal
        );
        low = length;
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof QrEncodingError)) throw error;
        high = length - 1;
      }
    }
    if (!low) throw new Error("Input does not fit a structured symbol");
    // Do not divide a Shift-JIS pair between symbols.
    if (options.kanji && !options.byte && offset + low < data.length) {
      let cursor = offset;
      while (cursor < offset + low) {
        const b = data[cursor]!;
        cursor += (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xeb) ? 2 : 1;
      }
      if (cursor > offset + low) low--;
    }
    parts.push(data.subarray(offset, offset + low));
    offset += low;
  }
  for (let index = 0; index < parts.length; index++) {
    await yieldTurn(signal);
    yield await drainCooperativeSteps(
      encodeQrSteps(parts[index]!, {
        ...options,
        strict: true,
        append: [index, parts.length, parity]
      }),
      signal
    );
  }
}

export function createQrencodeCommand(options: QrencodeCommandsOptions = {}): CommandDefinition {
  const limits: QrencodeLimits = {
    maxInputBytes: 113424,
    maxOutputBytes: 16 * 1024 * 1024,
    maxMemoryBytes: 64 * 1024 * 1024,
    ...options.limits
  };
  for (const [name, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid ${name}`);
  return {
    name: "qrencode",
    async execute(context: CommandContext) {
      context.signal.throwIfAborted();
      const fail = async (message: string) => {
        await writeBytes(context.stderr, new TextEncoder().encode(message + "\n"), context.signal);
        return { exitCode: 1 };
      };
      try {
        const carrier = getCommandArguments(context),
          parsed = parse(carrier.args);
        if (parsed.invalidValue) {
          const { label, index, offset } = parsed.invalidValue;
          await writeBytes(context.stderr, new TextEncoder().encode(`Invalid ${label}: `), context.signal);
          await writeBytes(context.stderr, carrier.bytes(index)!.subarray(offset), context.signal);
          return fail("");
        }
        if (parsed.invalidShortOption) {
          const { index, offset } = parsed.invalidShortOption;
          await writeBytes(context.stderr, new TextEncoder().encode("qrencode: invalid option -- '"), context.signal);
          await writeBytes(context.stderr, carrier.bytes(index)!.subarray(offset, offset + 1), context.signal);
          return fail("'\nTry \"qrencode --help\" for more information.");
        }
        if (!carrier.args.length) {
          await writeBytes(context.stderr, new TextEncoder().encode(help), context.signal);
          return { exitCode: 1 };
        }
        if (parsed.assistance) {
          await writeBytes(context.stdout, new TextEncoder().encode(parsed.assistance), context.signal);
          return { exitCode: 0 };
        }
        const type = parsed.render.type;
        if (parsed.output === undefined && (type === "PNG" || type === "PNG32"))
          return fail("No output filename is given.");
        if (parsed.encode.micro && (parsed.encode.version > 4 || parsed.encode.level === "H" || parsed.structured))
          throw new Error("Unsupported Micro QR version, level, or structured append");
        if (limits.maxMemoryBytes < 2 * 1024 * 1024)
          throw new Error("QR encoding exceeds memory budget");
        const inputLimit = Math.min(
          limits.maxInputBytes,
          Math.floor((limits.maxMemoryBytes - 2 * 1024 * 1024) / 64),
          parsed.structured ? 113424 : 7089
        );
        let data: Uint8Array;
        if (parsed.operand !== undefined) {
          if (carrier.args[parsed.operand]!.length > inputLimit)
            throw new Error("Input exceeds byte limit");
          data = carrier.bytes(parsed.operand)!;
        } else if (parsed.input !== undefined) {
          if (!parsed.input) return fail("Cannot read input file .");
          const path = resolvePath(context.cwd, parsed.input);
          try {
            const stat = await context.fs.stat(path, { signal: context.signal });
            if (stat.type === "directory") return fail("No input data.");
            if (stat.size > inputLimit) throw new Error("Input exceeds byte limit");
            data = context.fs.readStream
              ? await collectBytes(context.fs.readStream(path, { signal: context.signal }), {
                  maxBytes: inputLimit,
                  maxMemoryBytes: limits.maxMemoryBytes,
                  signal: context.signal
                })
              : await context.fs.readFile(path, { signal: context.signal, maxBytes: inputLimit });
          } catch (error) {
            context.signal.throwIfAborted();
            if (isFsError(error, "ENOENT") || isFsError(error, "ENOTDIR") || isFsError(error, "EACCES"))
              return fail(`Cannot read input file ${parsed.input}.`);
            throw error;
          }
        } else
          data = await collectBytes(context.stdin, {
            maxBytes: inputLimit,
            maxMemoryBytes: limits.maxMemoryBytes,
            signal: context.signal
          });
        if (data.length > inputLimit) throw new Error("Input exceeds byte limit");
        if (data.length * 64 + 2 * 1024 * 1024 > limits.maxMemoryBytes)
          throw new Error("QR encoding exceeds memory budget");
        if (!data.length && parsed.operand === undefined) return fail("No input data.");
        if (!parsed.encode.byte) {
          const nul = data.indexOf(0);
          if (nul >= 0) data = data.subarray(0, nul);
        }
        if (!data.length) return fail("Failed to encode the input data: Invalid argument");
        if (parsed.structured) {
          if (!parsed.encode.version) return fail("Version number must be specified to encode structured symbols.");
          if (parsed.output === undefined) return fail("An output filename must be specified to store the structured images.");
          if (type === "PNG32" || type === "ASCIIi" || type === "ANSI256UTF8") return fail("Unknown image type.");
        }
        if (parsed.ignorecase && !parsed.encode.byte) {
          data = data.slice();
          for (let i = 0; i < data.length; i++) {
            if (parsed.encode.kanji && kanjiValue(data, i) >= 0) {
              i++;
              continue;
            }
            if (data[i]! >= 97 && data[i]! <= 122) data[i] = data[i]! - 32;
          }
        }
        let outputBytes = 0;
        let i = 0;
        for await (const code of symbols(data, parsed.encode, parsed.structured, context.signal)) {
          await yieldTurn(context.signal);
          const output = renderQr(
            code,
            parsed.render,
            limits.maxMemoryBytes - data.length * 64 - code.modules.length ** 2 * 16
          );
          outputBytes += output.length;
          if (outputBytes > limits.maxOutputBytes) throw new Error("QR output exceeds byte limit");
          if (parsed.output !== undefined && (parsed.structured || parsed.output !== "-")) {
            let name = parsed.output;
            if (parsed.structured) {
              const ext = type === "PNG" || type === "SVG" || type === "EPS" ? "." + type.toLowerCase() : ".txt";
              const dot = name.length > ext.length && name.toLowerCase().endsWith(ext) ? name.length - ext.length : name.length;
              name = name.slice(0, dot) + "-" + String(i + 1).padStart(2, "0") + name.slice(dot);
            }
            if (!name) return fail("Failed to create file: \nNo such file or directory");
            await writeFileOutput(context, output, (bytes) =>
              context.fs.writeFile(resolvePath(context.cwd, name), bytes, {
                signal: context.signal
              })
            );
          } else await writeBytes(context.stdout, output, context.signal);
          i++;
        }
        return { exitCode: 0 };
      } catch (error) {
        context.signal.throwIfAborted();
        if (
          error instanceof Error &&
          (error.name === "BudgetExceededError" || error.name === "AbortError")
        )
          throw error;
        return fail(`qrencode: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
}
export function createQrencodeCommands(
  options: QrencodeCommandsOptions = {}
): readonly CommandDefinition[] {
  return [createQrencodeCommand(options)];
}
export function qrencodeCommands(options: QrencodeCommandsOptions = {}): VirtualShellPlugin {
  const command = createQrencodeCommand(options);
  return {
    name: "qrencode-commands",
    setup(host) {
      host.commands.register(command, { replace: options.replace ?? false });
    }
  };
}
