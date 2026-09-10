import type { CommandDefinition } from "../../contracts/index.js";
import { createOutputOperation } from "../../contracts/output.js";
import { Budget, GetoptError, settings, type GetoptCommandsOptions } from "./internal.js";
import { Writer } from "./io.js";
import { Parser, addLongOptions, findShort, type LongOption } from "./parser.js";

const wrapperOptions: readonly LongOption[] = [
  { name: "options", argument: 1, code: "o" }, { name: "longoptions", argument: 1, code: "l" },
  { name: "quiet", argument: 0, code: "q" }, { name: "quiet-output", argument: 0, code: "Q" },
  { name: "shell", argument: 1, code: "s" }, { name: "test", argument: 0, code: "T" },
  { name: "unquoted", argument: 0, code: "u" }, { name: "help", argument: 0, code: "h" },
  { name: "alternative", argument: 0, code: "a" }, { name: "name", argument: 1, code: "n" },
  { name: "version", argument: 0, code: "V" },
];

export function createGetoptCommand(options: GetoptCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "getopt", description: "Parse short and long options and emit shell-quoted arguments", async execute(context) {
    const output = createOutputOperation(context, context.stdout);
    const budget = new Budget(context, limits, output.signal);
    let writer: Writer | undefined;
    let failure: { reason: unknown } | undefined;
    let primary: { reason: unknown } | undefined;
    let exitCode = 0;
    try {
      writer = new Writer(budget, output);
      const args = await budget.arguments();
      const compatible = context.env.GETOPT_COMPATIBLE !== undefined;
      const posix = context.env.POSIXLY_CORRECT !== undefined;
      let specification: string | undefined;
      let parameters = args;
      const longOptions: LongOption[] = [];
      let quote = true, tcsh = false, quiet = false, quietOutput = false, alternative = false;
      let name = "getopt";
      let complete = false;
      if (!args.length) {
        if (!compatible) throw new GetoptError("missing optstring argument", 2, true);
        await writer.send([" --\n"]);
        complete = true;
      } else if (compatible || args[0]![0] !== "-") {
        let start = 0;
        while (args[0]![start] === "+" || args[0]![start] === "-") { await budget.step(); start++; }
        specification = args[0]!.slice(start);
        budget.schema(specification.length);
        parameters = args.slice(1);
        quote = false;
      } else {
        const wrapper = new Parser(args, "+ao:l:n:qQs:TuhV", wrapperOptions, false, posix, false, "getopt", budget, writer);
        for (;;) {
          const parsed = await wrapper.next();
          if (!parsed) break;
          if (parsed.kind === "error") { await writer.send(["Try 'getopt --help' for more information.\n"], true); exitCode = 2; complete = true; break; }
          if (parsed.kind === "operand") throw new GetoptError("unexpected wrapper operand");
          const option = parsed.kind === "long" ? parsed.option.code : parsed.option;
          switch (option) {
            case "o": specification = parsed.argument!; budget.schema(specification.length); break;
            case "l": await addLongOptions(parsed.argument!, longOptions, budget); break;
            case "n": name = parsed.argument!; break;
            case "a": alternative = true; break;
            case "q": quiet = true; break;
            case "Q": quietOutput = true; break;
            case "u": quote = false; break;
            case "s":
              if (parsed.argument === "bash" || parsed.argument === "sh") tcsh = false;
              else if (parsed.argument === "tcsh" || parsed.argument === "csh") tcsh = true;
              else throw new GetoptError("unknown shell after -s or --shell argument", 2, true);
              break;
            case "T": exitCode = 4; complete = true; break;
            case "V": await writer.send(["getopt (virtual-bash)\n"]); complete = true; break;
            case "h":
              await writer.send(["Usage: getopt [OPTIONS] -o OPTSTRING [--] PARAMETERS...\nParse short and long options and emit shell-quoted arguments.\nOptions: -a, --alternative; -l, --longoptions; -n, --name; -o, --options;\n         -q, --quiet; -Q, --quiet-output; -s, --shell; -T, --test;\n         -u, --unquoted; -h, --help; -V, --version\n"]);
              complete = true; break;
          }
          if (complete) break;
        }
        if (!complete) {
          if (specification === undefined) {
            if (wrapper.index === args.length) throw new GetoptError("missing optstring argument", 2, true);
            specification = args[wrapper.index++]!;
            budget.schema(specification.length);
          }
          parameters = args.slice(wrapper.index);
        }
      }
      if (!complete) {
        const parser = new Parser(parameters, specification!, longOptions, alternative, posix, quiet, name, budget, writer);
        for (;;) {
          const parsed = await parser.next();
          if (!parsed) break;
          if (parsed.kind === "error") { exitCode = 1; continue; }
          if (quietOutput) continue;
          if (parsed.kind === "operand") await writer.normalized(parsed.argument ?? "", quote, tcsh);
          else if (parsed.kind === "long") {
            await writer.send([" --", parsed.option.name]);
            if (parsed.option.argument) await writer.normalized(parsed.argument ?? "", quote, tcsh);
          } else {
            await writer.send([" -", parsed.option]);
            const offset = await findShort(specification!, parsed.option, 0, budget);
            if (offset >= 0 && specification![offset + 1] === ":") await writer.normalized(parsed.argument ?? "", quote, tcsh);
          }
        }
        if (!quietOutput) {
          await writer.send([" --"]);
          for (const operand of parser.operands) await writer.normalized(operand, quote, tcsh);
          for (let index = parser.index; index < parameters.length; index++) await writer.normalized(parameters[index]!, quote, tcsh);
          await writer.send(["\n"]);
        }
      }
    } catch (error) {
      primary = { reason: error };
      if (error instanceof GetoptError && !output.signal.aborted && writer) {
        exitCode = error.status;
        try { await writer.send(["getopt: ", error.message, "\n", error.usage ? "Try 'getopt --help' for more information.\n" : ""], true); }
        catch (reporting) { failure = { reason: new AggregateError([error, reporting], "getopt failure reporting failed") }; }
      } else failure = { reason: error };
    }
    try { await output.close(); }
    catch (cleanup) {
      const previous = failure ?? primary;
      failure = { reason: previous ? new AggregateError([previous.reason, cleanup], "getopt execution and cleanup failed") : cleanup };
    }
    context.signal.throwIfAborted();
    output.signal.throwIfAborted();
    if (failure) throw failure.reason;
    return { exitCode };
  } };
}
