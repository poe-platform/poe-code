import { FsError, type CommandDefinition } from "../../contracts/index.js";
import { createOutputOperation } from "../../contracts/output.js";
import { publicDiagnosticMessage } from "../../diagnostics.js";
import { Budget, PrError, fileQuote, quote, settings, type PrCommandsOptions } from "./internal.js";
import { Lifecycle, Reader, fsDetail } from "./io.js";
import { parseOptions } from "./options.js";
import { Formatter } from "./format.js";
import { formatDate } from "../time-env/format.js";
import { TimeZone } from "../time-env/calendar.js";
import { CommandFailure } from "../time-env/shared.js";

export function createPrCommand(options: PrCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "pr", description: "Paginate files and print balanced or merged columns", async execute(context) {
    const output = createOutputOperation(context, context.stdout);
    const budget = new Budget(context, limits, output.signal);
    let lifecycle: Lifecycle | undefined;
    let failure: { reason: unknown } | undefined;
    let primary: { reason: unknown } | undefined;
    let exitCode = 0;
    try {
      lifecycle = new Lifecycle(budget, output);
      const parsed = parseOptions(budget.arguments(), budget);
      if (parsed.information) {
        await lifecycle.write(parsed.information === "version" ? "pr (virtual-bash)\n" : "Usage: pr [OPTION]... [FILE]...\nPaginate or columnate files for printing.\nOptions: -COLUMNS -h HEADER -l LENGTH -w WIDTH -t -n[SEP[DIGITS]] -m -s[SEP]\n  --date-format=FORMAT  format the header date\n");
      } else {
        const ctype = context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C";
        const timeLocale = context.env.LC_ALL || context.env.LC_TIME || context.env.LANG || "C";
        for (const locale of [ctype, timeLocale]) if (!["C", "POSIX", "C.UTF-8", "C.utf8"].includes(locale)) throw new PrError(`unsupported locale ${quote(locale)}`);
        let sampled: number | undefined;
        const date = (reader: Reader | undefined): string => {
          let milliseconds: number;
          if (reader?.stat) milliseconds = reader.stat.mtimeMs;
          else milliseconds = sampled ??= (options.clock ?? Date.now)();
          const value = new Date(milliseconds);
          if (!Number.isFinite(milliseconds) || Number.isNaN(value.getTime())) throw new PrError("invalid header timestamp");
          if (parsed.dateFormat !== undefined) {
            try {
              return formatDate(parsed.dateFormat, BigInt(Math.trunc(milliseconds)) * 1_000_000n, new TimeZone("UTC"), {
                maxArguments: limits.maxArguments, maxArgumentBytes: limits.maxArgumentBytes,
                maxOutputBytes: Math.min(limits.maxBufferedBytes, limits.maxOutputBytes),
                maxEnvironmentEntries: 1, maxFormatWidth: limits.maxPageWidth,
              }).slice(0, -1);
            } catch (error) {
              if (error instanceof CommandFailure || error instanceof FsError) throw new PrError(error.message);
              throw error;
            }
          }
          const year = String(value.getUTCFullYear()).padStart(4, "0");
          const month = String(value.getUTCMonth() + 1).padStart(2, "0");
          const day = String(value.getUTCDate()).padStart(2, "0");
          const time = `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
          if (context.env.POSIXLY_CORRECT !== undefined && (timeLocale === "C" || timeLocale === "POSIX")) return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][value.getUTCMonth()]} ${String(value.getUTCDate()).padStart(2, " ")} ${time} ${year}`;
          return `${year}-${month}-${day} ${time}`;
        };
        let stdin: Reader | undefined;
        const open = async (name: string): Promise<Reader | undefined> => {
          if (name === "-" && stdin) return stdin;
          const reader = new Reader(name, lifecycle!);
          try { await reader.open(); }
          catch (error) {
            if (!(error instanceof FsError)) throw error;
            exitCode = 1;
            if (!parsed.quiet) {
              await lifecycle!.write(`pr: ${fileQuote(name)}: ${fsDetail(error)}\n`, true);
            }
            return undefined;
          }
          if (name === "-") stdin = reader;
          return reader;
        };
        const names = parsed.files.length ? parsed.files : ["-"];
        if (!parsed.files.length) parsed.merge = false;
        const groups = parsed.merge ? [names] : names.map(name => [name]);
        for (const group of groups) {
          const formatter = new Formatter({ ...parsed }, lifecycle, group.length);
          const readers: Reader[] = [];
          for (const name of group) { const reader = await open(name); if (reader) readers.push(reader); }
          if (!readers.length) continue;
          const title = parsed.header ?? (parsed.merge || readers[0]!.name === "-" ? "" : readers[0]!.name);
          await formatter.run(readers, date(parsed.merge ? undefined : readers[0]), title);
        }
      }
    } catch (error) {
      primary = { reason: error };
      failure = { reason: error };
      if (!output.signal.aborted && lifecycle && error instanceof PrError) {
        exitCode = 1;
        try {
          await lifecycle.write(`pr: ${publicDiagnosticMessage(error, context.onInternalError)}\n`, true);
          if (error.usage) await lifecycle.write("Try 'pr --help' for more information.\n", true);
          failure = undefined;
        } catch (reporting) { failure = { reason: new AggregateError([error, reporting], "pr failure reporting failed") }; }
      }
    }
    try { await output.close(); }
    catch (cleanup) {
      const previous = failure ?? primary;
      failure = { reason: previous ? new AggregateError([previous.reason, cleanup], "pr execution and cleanup failed") : cleanup };
    }
    context.signal.throwIfAborted();
    output.signal.throwIfAborted();
    if (failure) throw failure.reason;
    return { exitCode };
  } };
}
