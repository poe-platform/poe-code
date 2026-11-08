import { adjustDate, isEpochSeconds, type DateAdjustment, parseAdjustment } from "./adjustments.js";
import { utf8ByteLength } from "safe-bash-byte-engine";
import { FsError } from "safe-bash-contracts";
import { input as fileInput, lines, pathOf } from "safe-bash-io-engine/internal";
import { writeDiagnostic } from "safe-bash-contracts/escaping";
import { TimeZone, millisecondsInstant, parseDate } from "safe-bash-calendar-engine/time-env/calendar";
import { formatDate } from "safe-bash-calendar-engine/time-env/format";
import { checkSize, command, CommandFailure, emit, ownEnvironment, timeEnvExecutorSettings, type Settings, type TimeEnvLimits } from "safe-bash-calendar-engine/time-env/shared";

interface DateArguments {
  readonly input?: string;
  readonly reference?: string;
  readonly file?: string;
  readonly utc: boolean;
  readonly epochReference?: boolean;
  readonly adjustments?: readonly DateAdjustment[];
  readonly format: string;
  readonly informational?: "help" | "version";
}

function parseArguments(args: readonly string[]): DateArguments {
  let input: string | undefined, reference: string | undefined, format: string | undefined, style: string | undefined;
  let utc = false, ended = false;
  let file: string | undefined;
  let epochReference = false;
  const adjustments: DateAdjustment[] = [];
  const formatted = (value: string): void => {
    if (style !== undefined) throw new CommandFailure("multiple output formats specified");
    style = value;
  };
  const iso = (value: string): string => {
    if (value) {
      if ("date".startsWith(value)) return "%F";
      if ("hours".startsWith(value)) return "%FT%H%:z";
      if ("minutes".startsWith(value)) return "%FT%H:%M%:z";
      if ("seconds".startsWith(value)) return "%FT%T%:z";
      if ("ns".startsWith(value)) return "%FT%T,%N%:z";
    }
    throw new CommandFailure(`unsupported ISO precision: ${value}`);
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (!ended && argument === "--") { ended = true; continue; }
    if (!ended && argument.startsWith("--")) {
      const separator = argument.indexOf("=");
      const name = separator < 0 ? argument : argument.slice(0, separator);
      const attached = separator < 0 ? undefined : argument.slice(separator + 1);
      const required = (): string => {
        const value = attached ?? args[++index];
        if (value === undefined) throw new CommandFailure(`option requires an argument: ${name}`);
        return value;
      };
      if (["--help", "--version", "--utc", "--universal", "--rfc-email", "--rfc-2822", "--rfc-822"].includes(name) && attached !== undefined) {
        throw new CommandFailure(`option does not allow an argument: ${name}`);
      }
      switch (name) {
        case "--help": return { utc, format: "", informational: "help" };
        case "--version": return { utc, format: "", informational: "version" };
        case "--utc": case "--universal": utc = true; break;
        case "--date": input = required(); break;
        case "--reference": reference = required(); epochReference = false; break;
        case "--file": file = required(); break;
        case "--iso-8601": formatted(iso(attached ?? "date")); break;
        case "--rfc-email": case "--rfc-2822": case "--rfc-822": formatted("%a, %d %b %Y %T %z"); break;
        case "--rfc-3339": {
          const precision = required();
          if (!precision || !["date", "seconds", "ns"].some(item => item.startsWith(precision))) {
            throw new CommandFailure(`unsupported RFC3339 precision: ${precision}`);
          }
          formatted("date".startsWith(precision) ? "%F" : "ns".startsWith(precision) ? "%F %T.%N%:z" : "%F %T%:z");
          break;
        }
        case "--set": throw new CommandFailure("setting clocks is unsupported");
        default: throw new CommandFailure(`unsupported option: ${name}`);
      }
    } else if (!ended && argument.startsWith("-") && argument !== "-") {
      for (let position = 1; position < argument.length; position++) {
        const flag = argument[position]!;
        if (flag === "u") utc = true;
        else if (flag === "j") continue;
        else if (flag === "R") formatted("%a, %d %b %Y %T %z");
        else if (flag === "I") { formatted(iso(argument.slice(position + 1) || "date")); break; }
        else if (flag === "d" || flag === "r" || flag === "f" || flag === "v") {
          const value = argument.slice(position + 1) || args[++index];
          if (value === undefined) throw new CommandFailure(`option requires an argument: -${flag}`);
          if (flag === "d") input = value;
          else if (flag === "r") { reference = value; epochReference = true; }
          else if (flag === "v") adjustments.push(parseAdjustment(value));
          else file = value;
          break;
        } else if (flag === "s") throw new CommandFailure("setting clocks is unsupported");
        else throw new CommandFailure(`unsupported option: -${flag}`);
      }
    } else {
      if (!argument.startsWith("+")) throw new CommandFailure("expected +FORMAT; clock-setting operands are unsupported");
      if (format !== undefined) throw new CommandFailure("extra format operand");
      format = argument.slice(1);
    }
  }
  if (input !== undefined && reference !== undefined) throw new CommandFailure("--date and --reference are mutually exclusive");
  if (file !== undefined && (input !== undefined || reference !== undefined)) throw new CommandFailure("--file, --date and --reference are mutually exclusive");
  if (format !== undefined && style !== undefined) throw new CommandFailure("multiple output formats specified");
  return { utc, epochReference, adjustments, format: format ?? style ?? "%a %b %e %T %Z %Y",
    ...(input === undefined ? {} : { input }), ...(reference === undefined ? {} : { reference }),
    ...(file === undefined ? {} : { file }) };
}

export function createDateWithSettings(configuration: Settings) {
  new TimeZone(configuration.defaultTimeZone);
  return command("date", configuration, async context => {
    const parsed = parseArguments(context.args);
    if (parsed.informational) {
      await emit(context, parsed.informational === "version" ? "date (safe-bash virtual command)\n"
        : "Usage: date [-uj] [-d DATE | -r FILE_OR_SECONDS | -f FILE] [-v[+|-]VALUE[ymwdHMS]] [+FORMAT]\n-f, --file=FILE reads one date per line; FILE - reads stdin.\nAlso: -I[date|hours|minutes|seconds|ns], -R, --rfc-3339=PRECISION\nDATE accepts @seconds, ISO calendar/time, RFC dates, now/today/yesterday/tomorrow, and integer seconds/minutes/hours relative to now.\nVirtual TZ defaults to UTC; no clock setting or host-locale parsing.\n", configuration.limits);
      return 0;
    }
    const zone = new TimeZone(parsed.utc ? "UTC" : ownEnvironment(context, "TZ") ?? configuration.defaultTimeZone);
    let current: bigint | undefined;
    const now = (): bigint => current ??= millisecondsInstant(configuration.clock());
    if (parsed.file !== undefined) {
      let exitCode = 0, outputBytes = 0;
      const source = async function* () {
        try { yield* fileInput(context, parsed.file!); }
        catch (error) {
          context.signal.throwIfAborted();
          if (error instanceof FsError && error.code !== "EFBIG") throw new CommandFailure(error.message);
          throw error;
        }
      };
      for await (const line of lines(source(), 10,
        size => checkSize(size, configuration.limits.maxArgumentBytes, "date input line"))) {
        let instant: bigint;
        try { instant = parseDate(new TextDecoder().decode(line.bytes), zone, now); }
        catch (error) {
          context.signal.throwIfAborted();
          if (!(error instanceof CommandFailure)) throw error;
          await writeDiagnostic(context.stderr, `date: ${error.message}\n`, context.signal);
          exitCode = 1;
          continue;
        }
        const value = formatDate(parsed.format, adjustDate(instant, parsed.adjustments ?? [], zone), zone, configuration.limits);
        outputBytes += utf8ByteLength(value);
        checkSize(outputBytes, configuration.limits.maxOutputBytes, "output");
        await emit(context, value, configuration.limits);
      }
      return exitCode;
    }
    let instant: bigint;
    if (parsed.reference !== undefined) {
      try {
        if (!parsed.reference) throw new FsError("ENOENT", { path: parsed.reference });
        const stat = await context.fs.stat(pathOf(context, parsed.reference), { signal: context.signal });
        context.signal.throwIfAborted();
        instant = millisecondsInstant(stat.mtimeMs);
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof FsError && error.code === "ENOENT" && parsed.epochReference && isEpochSeconds(parsed.reference)) {
          instant = parseDate("@" + parsed.reference, zone, now);
        } else {
          if (error instanceof FsError) throw new CommandFailure(error.message);
          throw error;
        }
      }
    } else instant = parsed.input === undefined ? now() : parseDate(parsed.input, zone, now);
    await emit(context, formatDate(parsed.format, adjustDate(instant, parsed.adjustments ?? [], zone), zone, configuration.limits), configuration.limits);
    return 0;
  });
}

const DEFAULT_SYNC_DATE_LIMITS: TimeEnvLimits = Object.freeze({
  maxArguments: Infinity,
  maxArgumentBytes: Infinity,
  maxOutputBytes: Infinity,
  maxEnvironmentEntries: Infinity,
  maxFormatWidth: Infinity,
});

export function evalSyncDate(
  args: readonly string[],
  tzEnv: string | undefined,
  execFn?: unknown,
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  statMtimeMsSync?: (filePath: string) => number | undefined,
  stdinBytes?: Uint8Array,
): string | undefined {
  const cfg = execFn ? timeEnvExecutorSettings.get(execFn as never) : undefined;
  if (execFn && !cfg) return undefined;
  const limits = cfg?.limits ?? DEFAULT_SYNC_DATE_LIMITS;
  if (args.length > limits.maxArguments) return undefined;
  let argBytes = 0;
  for (let i = 0; i < args.length; i++) {
    argBytes += utf8ByteLength(args[i]!);
    if (argBytes > limits.maxArgumentBytes) return undefined;
  }
  try {
    const parsed = parseArguments(args);
    if (parsed.informational) {
      return undefined;
    }
    const zone = new TimeZone(parsed.utc ? "UTC" : tzEnv ?? cfg?.defaultTimeZone ?? "UTC");
    const clock = cfg?.clock ?? Date.now;
    let current: bigint | undefined;
    const now = (): bigint => (current ??= millisecondsInstant(clock()));
    if (parsed.file !== undefined) {
      const fBytes = parsed.file === "-" ? stdinBytes : readFileSync?.(parsed.file);
      if (!fBytes || fBytes.byteLength > 16384 || fBytes.includes(0)) return undefined;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(fBytes);
      const rawLines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : (text.length === 0 ? [] : text.split("\n"));
      let out = "";
      for (const line of rawLines) {
        if (utf8ByteLength(line) > limits.maxArgumentBytes) return undefined;
        const inst = parseDate(line, zone, now);
        out += formatDate(parsed.format, adjustDate(inst, parsed.adjustments ?? [], zone), zone, limits);
        if (utf8ByteLength(out) > limits.maxOutputBytes) return undefined;
      }
      return out.includes("\0") ? undefined : out;
    }
    let instant: bigint;
    if (parsed.reference !== undefined) {
      if (!parsed.reference || !statMtimeMsSync) return undefined;
      const mtimeMs = statMtimeMsSync(parsed.reference);
      // An unavailable synchronous stat is not proof of ENOENT. Let async stat
      // distinguish missing files from permission, symlink and provider errors.
      if (mtimeMs === undefined) return undefined;
      instant = millisecondsInstant(mtimeMs);
    } else {
      instant = parsed.input === undefined ? now() : parseDate(parsed.input, zone, now);
    }
    const out = formatDate(parsed.format, adjustDate(instant, parsed.adjustments ?? [], zone), zone, limits);
    if (utf8ByteLength(out) > limits.maxOutputBytes || out.includes("\0")) return undefined;
    return out;
  } catch {
    return undefined;
  }
}
