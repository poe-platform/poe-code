import { FsError, type CommandDefinition } from "../../contracts/index.js";
import { publicDiagnosticMessage } from "../../diagnostics.js";
import { RegexExecutor, withRegexSession } from "../regex-execution/portable.js";
import { ExprMatchError } from "../regex-execution/protocol.js";
import { Budget, CsplitError, fsDetail, settings, type CsplitCommandsOptions } from "./internal.js";
import { Lifecycle, Lines, Outputs } from "./io.js";
import { parseOptions, suffixFormatter } from "./options.js";
import { Matcher, preparePatterns } from "./patterns.js";
import { Splitter } from "./split.js";

export type { CsplitCommandsOptions, CsplitLimits } from "./internal.js";

export function createCsplitCommandWithExecutor(executor: RegexExecutor, options: CsplitCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "csplit", description: "Split files at bounded line and BRE boundaries", async execute(context) {
    return withRegexSession(context, executor, async session => {
      const budget = new Budget(context, limits);
      const lifecycle = new Lifecycle(budget);
      let output: Outputs | undefined;
      let failure: { reason: unknown } | undefined;
      let primary: { reason: unknown } | undefined;
      let exitCode = 0;
      try {
        const parsed = parseOptions(budget.arguments(), budget);
        if (parsed.information) {
          await budget.print(parsed.information === "version" ? "csplit (virtual-bash)\n" : "Usage: csplit [OPTION]... FILE PATTERN...\nOptions: -f PREFIX, -b SUFFIX, -k, -z, -n DIGITS, -s, --suppress-matched\nPatterns: INTEGER, /REGEXP/[OFFSET], %REGEXP%[OFFSET], {INTEGER}, {*}\n");
        } else {
          const format = suffixFormatter(parsed, budget);
          const input = new Lines(lifecycle);
          try { await input.open(parsed.operands[0]!); }
          catch (error) {
            if (error instanceof FsError) throw new CsplitError(`cannot open ${budget.quote(parsed.operands[0]!)} for reading: ${fsDetail(error)}`);
            throw error;
          }
          const matcher = new Matcher(session, budget);
          const patterns = await preparePatterns(parsed.operands.slice(1), matcher);
          output = new Outputs(lifecycle, parsed, format, input);
          await new Splitter(input, output, matcher).run(patterns);
          output.succeeded = true;
        }
      } catch (error) {
        primary = { reason: error };
        failure = { reason: error };
        if (output && error instanceof CsplitError && error.preserve) output.preserve = true;
        if (!context.signal.aborted) {
          exitCode = 1;
          try {
            const message = error instanceof ExprMatchError ? error.message : error instanceof FsError ? fsDetail(error) : publicDiagnosticMessage(error, context.onInternalError);
            await budget.print(`csplit: ${message}\n`, true);
            if (error instanceof CsplitError && error.usage) await budget.print("Try 'csplit --help' for more information.\n", true);
            if (!(error instanceof CsplitError && error.preserve)) await output?.finish();
            failure = undefined;
          } catch (reporting) { failure = { reason: new AggregateError([error, reporting], "csplit failure reporting failed") }; }
        }
      }
      try { await lifecycle.close(); }
      catch (cleanup) {
        const previous = failure ?? primary;
        failure = { reason: previous ? new AggregateError([previous.reason, cleanup], "csplit execution and cleanup failed") : cleanup };
      }
      context.signal.throwIfAborted();
      if (failure) throw failure.reason;
      return { exitCode };
    });
  } };
}
