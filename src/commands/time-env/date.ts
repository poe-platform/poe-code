import { FsError, resolvePath } from "../../contracts/index.js";
import { TimeZone, millisecondsInstant, parseDate } from "./calendar.js";
import { formatDate } from "./format.js";
import { command, CommandFailure, emit, ownEnvironment, type Settings } from "./shared.js";

interface DateArguments {
  readonly input?: string;
  readonly reference?: string;
  readonly utc: boolean;
  readonly format: string;
  readonly informational?: "help" | "version";
}

function parseArguments(args: readonly string[]): DateArguments {
  let input: string | undefined, reference: string | undefined, format: string | undefined, style: string | undefined;
  let utc = false, ended = false;
  const formatted = (value: string): void => {
    if (style !== undefined) throw new CommandFailure("multiple output formats specified");
    style = value;
  };
  const iso = (value: string): string => {
    switch (value) {
      case "date": return "%F";
      case "hours": return "%FT%H%:z";
      case "minutes": return "%FT%H:%M%:z";
      case "seconds": return "%FT%T%:z";
      case "ns": return "%FT%T,%N%:z";
      default: throw new CommandFailure(`unsupported ISO precision: ${value}`);
    }
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
      if (["--help", "--version", "--utc", "--universal", "--rfc-email", "--rfc-2822"].includes(name) && attached !== undefined) {
        throw new CommandFailure(`option does not allow an argument: ${name}`);
      }
      switch (name) {
        case "--help": return { utc, format: "", informational: "help" };
        case "--version": return { utc, format: "", informational: "version" };
        case "--utc": case "--universal": utc = true; break;
        case "--date": input = required(); break;
        case "--reference": reference = required(); break;
        case "--iso-8601": formatted(iso(attached ?? "date")); break;
        case "--rfc-email": case "--rfc-2822": formatted("%a, %d %b %Y %T %z"); break;
        case "--rfc-3339": {
          const precision = required();
          if (!["date", "seconds", "ns"].includes(precision)) throw new CommandFailure(`unsupported RFC3339 precision: ${precision}`);
          formatted(precision === "date" ? "%F" : precision === "ns" ? "%F %T.%N%:z" : "%F %T%:z");
          break;
        }
        case "--set": throw new CommandFailure("setting clocks is unsupported");
        default: throw new CommandFailure(`unsupported option: ${name}`);
      }
    } else if (!ended && argument.startsWith("-") && argument !== "-") {
      for (let position = 1; position < argument.length; position++) {
        const flag = argument[position]!;
        if (flag === "u") utc = true;
        else if (flag === "R") formatted("%a, %d %b %Y %T %z");
        else if (flag === "I") { formatted(iso(argument.slice(position + 1) || "date")); break; }
        else if (flag === "d" || flag === "r") {
          const value = argument.slice(position + 1) || args[++index];
          if (value === undefined) throw new CommandFailure(`option requires an argument: -${flag}`);
          if (flag === "d") input = value; else reference = value;
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
  if (format !== undefined && style !== undefined) throw new CommandFailure("multiple output formats specified");
  return { utc, format: format ?? style ?? "%a %b %e %T %Z %Y",
    ...(input === undefined ? {} : { input }), ...(reference === undefined ? {} : { reference }) };
}

export function createDateCommand(configuration: Settings) {
  new TimeZone(configuration.defaultTimeZone);
  return command("date", configuration, async context => {
    const parsed = parseArguments(context.args);
    if (parsed.informational) {
      await emit(context, parsed.informational === "version" ? "date (safe-bash virtual command)\n"
        : "Usage: date [-u] [-d DATE | -r FILE] [+FORMAT]\nAlso: -I[date|hours|minutes|seconds|ns], -R, --rfc-3339=PRECISION\nDATE accepts @seconds, ISO calendar/time, RFC dates, now/today/yesterday/tomorrow, and integer seconds/minutes/hours relative to now.\nVirtual TZ defaults to UTC; no clock setting or host-locale parsing.\n", configuration.limits);
      return 0;
    }
    const zone = new TimeZone(parsed.utc ? "UTC" : ownEnvironment(context, "TZ") ?? configuration.defaultTimeZone);
    let current: bigint | undefined;
    const now = (): bigint => current ??= millisecondsInstant(configuration.clock());
    let instant: bigint;
    if (parsed.reference !== undefined) {
      try {
        if (!parsed.reference) throw new FsError("ENOENT", { path: parsed.reference });
        const stat = await context.fs.stat(resolvePath(context.cwd, parsed.reference), { signal: context.signal });
        context.signal.throwIfAborted();
        instant = millisecondsInstant(stat.mtimeMs);
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof FsError) throw new CommandFailure(error.message);
        throw error;
      }
    } else instant = parsed.input === undefined ? now() : parseDate(parsed.input, zone, now);
    await emit(context, formatDate(parsed.format, instant, zone, configuration.limits), configuration.limits);
    return 0;
  });
}
