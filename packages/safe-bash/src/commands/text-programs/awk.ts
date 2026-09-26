import type { CommandDefinition } from "../../contracts/index.js";
import { AwkParser, builtinArities, decodeString, type AwkProgram } from "./awk-syntax.js";
import { AwkRuntime } from "./awk-runtime.js";
import { AwkRetention } from "./awk-retention.js";
import { AwkInspection, type AwkInspectionOptions } from "./awk-inspection.js";
import { prettyAwk } from "./awk-pretty.js";
import { quoteAwk } from "./awk-quote.js";
import { writeFileOutput } from "../../contracts/filesystem-output.js";
import { Budget, ProgramError, byteString, bytes, command, readProgram, virtualPath, write, type TextProgramOptions } from "./shared.js";

const ordchrArities = Object.freeze({ ...builtinArities, ord: [1, 1] as const, chr: [1, 1] as const });
const awkProgramCache = new Map<string, AwkProgram>();
const EMPTY_ARGS: readonly string[] = Object.freeze([]);
let sharedRetention: AwkRetention | undefined;

export function awkCommand(options: TextProgramOptions = {}): CommandDefinition {
  return command("awk", context => {
    const budget = new Budget(context, options);
    const programs: string[] = [];
    const assignments: string[] = [];
    let separator: string | undefined;
    let hasMain = false;
    let ordchr = false;
    let operandAssignments = true;
    let generatePot = false;
    const inspection: AwkInspectionOptions = {};
    let pretty: string | undefined;
    let debug: string | undefined;
    let hasProgramFile = false;
    let needsAsyncFlags = false;
    let index = 0;
    for (; index < context.args.length; index++) {
      const argument = context.args[index]!;
      if (argument === "--") { index++; break; }
      if (argument === "-" || !argument.startsWith("-")) break;
      // The runtime already treats strings and records as raw byte strings.
      if (argument === "--characters-as-bytes" || argument === "-b") continue;
      if (argument === "--gen-pot" || argument === "-g") { generatePot = true; needsAsyncFlags = true; continue; }
      const equals = argument.indexOf("=");
      const option = argument.startsWith("--") ? argument.slice(0, equals < 0 ? undefined : equals) : `-${argument[1]}`;
      if (argument === "-I" || argument === "--trace") { inspection.trace = true; continue; }
      if (["-d", "--dump-variables", "-p", "--profile", "-o", "--pretty-print", "-D", "--debug"].includes(option)) {
        needsAsyncFlags = true;
        const destination = argument.startsWith("--") ? equals < 0 ? undefined : argument.slice(equals + 1) : argument.length > 2 ? argument.slice(2) : undefined;
        if (option === "-d" || option === "--dump-variables") inspection.dump = destination ?? "awkvars.out";
        else if (option === "-p" || option === "--profile") inspection.profile = destination ?? "awkprof.out";
        else if (option === "-o" || option === "--pretty-print") pretty = destination ?? "awkprof.out";
        else {
          if (!destination) throw new ProgramError("debugging requires an explicit VFS command file; interactive debugging is unavailable");
          debug = destination;
        }
        continue;
      }
      const flag = option === "--field-separator" ? "F" : option === "--source" ? "e" : option === "--exec" ? "E" : option === "--include" ? "i" : option === "--load" ? "l" : option.startsWith("--") ? undefined : argument[1];
      if (flag !== "F" && flag !== "v" && flag !== "f" && flag !== "e" && flag !== "E" && flag !== "i" && flag !== "l") throw new ProgramError(`unsupported awk option '${argument}'`);
      const attached = argument.startsWith("--") ? equals < 0 ? undefined : argument.slice(equals + 1) : argument.length > 2 ? argument.slice(2) : undefined;
      const value = attached ?? context.args[++index];
      if (value === undefined) throw new ProgramError(`${option} requires an argument`);
      if (flag === "l") {
        // A module selector, never a host-library or VFS payload read.
        const name = value.slice(value.lastIndexOf("/") + 1);
        if (name !== "ordchr" && name !== "ordchr.so") throw new ProgramError(`unsupported awk extension '${value}'`);
        ordchr = true;
      }
      if (flag === "F") separator = decodeString(byteString(value));
      if (flag === "v") {
        if (!/^[A-Za-z_][A-Za-z0-9_]*=/u.test(value)) throw new ProgramError("-v requires a NAME=value assignment");
        assignments.push(byteString(value));
      }
      if (flag === "f" || flag === "E" || flag === "i") { needsAsyncFlags = true; break; }
      if (flag === "e") {
        programs.push(byteString(value));
        hasMain = true;
      }
    }
    if (!needsAsyncFlags) {
      if (!hasMain) {
        const programArg = context.args[index++];
        if (programArg === undefined) throw new ProgramError("missing awk program");
        programs.push(byteString(programArg));
      }
      const source = programs.length === 1 ? programs[0]! : programs.join("\n");
      const arities = ordchr ? ordchrArities : builtinArities;
      const canCache = options.maxSteps === undefined && source.length <= 8192;
      const cacheKey = canCache ? (ordchr ? `1:${source}` : `0:${source}`) : "";
      let program = canCache ? awkProgramCache.get(cacheKey) : undefined;
      if (!program) {
        const parser = new AwkParser(source, arities);
        program = parser.parse();
        if (canCache) {
          if (awkProgramCache.size >= 64) awkProgramCache.delete(awkProgramCache.keys().next().value!);
          awkProgramCache.set(cacheKey, program);
        }
      }
      const hasInspection = inspection.trace !== undefined || inspection.dump !== undefined || inspection.profile !== undefined;
      const observer = hasInspection ? new AwkInspection(context, budget, inspection) : undefined;
      const remainingArgs = index >= context.args.length ? EMPTY_ARGS : context.args.slice(index);
      const maxRetained = options.maxRetainedBytes ?? Infinity;
      let retention: AwkRetention;
      if (maxRetained === Infinity && sharedRetention && sharedRetention.retainedBytes === 0) {
        (sharedRetention as unknown as { signal: AbortSignal }).signal = context.signal;
        retention = sharedRetention;
      } else {
        retention = new AwkRetention(maxRetained, context.signal);
        if (maxRetained === Infinity) sharedRetention = retention;
      }
      return new AwkRuntime(program, context, budget, retention, remainingArgs, assignments, separator, operandAssignments, ordchr, observer).runSyncOrAsync();
    }
    return (async () => {
    programs.length = 0;
    assignments.length = 0;
    separator = undefined;
    hasMain = false;
    ordchr = false;
    operandAssignments = true;
    generatePot = false;
    pretty = undefined;
    debug = undefined;
    hasProgramFile = false;
    index = 0;
    for (; index < context.args.length; index++) {
      const argument = context.args[index]!;
      if (argument === "--") { index++; break; }
      if (argument === "-" || !argument.startsWith("-")) break;
      if (argument === "--characters-as-bytes" || argument === "-b") continue;
      if (argument === "--gen-pot" || argument === "-g") { generatePot = true; continue; }
      const equals = argument.indexOf("=");
      const option = argument.startsWith("--") ? argument.slice(0, equals < 0 ? undefined : equals) : `-${argument[1]}`;
      if (argument === "-I" || argument === "--trace") { inspection.trace = true; continue; }
      if (["-d", "--dump-variables", "-p", "--profile", "-o", "--pretty-print", "-D", "--debug"].includes(option)) {
        const destination = argument.startsWith("--") ? equals < 0 ? undefined : argument.slice(equals + 1) : argument.length > 2 ? argument.slice(2) : undefined;
        if (option === "-d" || option === "--dump-variables") inspection.dump = destination ?? "awkvars.out";
        else if (option === "-p" || option === "--profile") inspection.profile = destination ?? "awkprof.out";
        else if (option === "-o" || option === "--pretty-print") pretty = destination ?? "awkprof.out";
        else {
          if (!destination) throw new ProgramError("debugging requires an explicit VFS command file; interactive debugging is unavailable");
          debug = destination;
        }
        continue;
      }
      const flag = option === "--field-separator" ? "F" : option === "--source" ? "e" : option === "--exec" ? "E" : option === "--include" ? "i" : option === "--load" ? "l" : option.startsWith("--") ? undefined : argument[1];
      if (flag !== "F" && flag !== "v" && flag !== "f" && flag !== "e" && flag !== "E" && flag !== "i" && flag !== "l") throw new ProgramError(`unsupported awk option '${argument}'`);
      const attached = argument.startsWith("--") ? equals < 0 ? undefined : argument.slice(equals + 1) : argument.length > 2 ? argument.slice(2) : undefined;
      const value = attached ?? context.args[++index];
      if (value === undefined) throw new ProgramError(`${option} requires an argument`);
      if (flag === "l") {
        const name = value.slice(value.lastIndexOf("/") + 1);
        if (name !== "ordchr" && name !== "ordchr.so") throw new ProgramError(`unsupported awk extension '${value}'`);
        ordchr = true;
      }
      if (flag === "F") separator = decodeString(byteString(value));
      if (flag === "v") {
        if (!/^[A-Za-z_][A-Za-z0-9_]*=/u.test(value)) throw new ProgramError("-v requires a NAME=value assignment");
        assignments.push(byteString(value));
      }
      if (flag === "f" || flag === "E" || flag === "i") programs.push(await readProgram(context, value));
      if (flag === "f" || flag === "E") hasProgramFile = true;
      if (flag === "e") programs.push(byteString(value));
      if (flag === "f" || flag === "e" || flag === "E") hasMain = true;
      if (flag === "E") { operandAssignments = false; index++; break; }
    }
    if (!hasMain) {
      const program = context.args[index++];
      if (program === undefined) throw new ProgramError("missing awk program");
      programs.push(byteString(program));
    }
    const source = programs.length === 1 ? programs[0]! : programs.join("\n");
    const arities = ordchr ? ordchrArities : builtinArities;
    const canCache = !generatePot && options.maxSteps === undefined && source.length <= 8192;
    const cacheKey = canCache ? (ordchr ? `1:${source}` : `0:${source}`) : "";
    let program = canCache ? awkProgramCache.get(cacheKey) : undefined;
    let parser: AwkParser | undefined;
    if (!program) {
      parser = new AwkParser(source, arities);
      program = parser.parse();
      if (canCache) {
        if (awkProgramCache.size >= 64) awkProgramCache.delete(awkProgramCache.keys().next().value!);
        awkProgramCache.set(cacheKey, program);
      }
    }
    if (debug !== undefined) {
      if (!hasProgramFile) throw new ProgramError("debugging requires a program supplied with -f");
      const commands = await readProgram(context, debug);
      let run = false;
      for (const line of commands.split("\n")) {
        budget.step(line.length + 1);
        const action = line.trim();
        if (!action || action.startsWith("#")) continue;
        if (action === "quit" || action === "q") break;
        if (action === "run" || action === "r") {
          if (run) throw new ProgramError("batch debugging supports a single run");
          run = true;
        } else throw new ProgramError(`unsupported batch debugger command '${action}'; supported commands are run and quit`);
      }
      if (!run) return 0;
    }
    if (pretty !== undefined) {
      const output = prettyAwk(program, budget);
      const destination = virtualPath(context, pretty);
      await writeFileOutput(context, bytes(output), chunk => context.fs.writeFile(destination, chunk, { signal: context.signal }));
      if (inspection.profile === undefined) return 0;
    }
    if (generatePot) {
      let output = "";
      for (const message of parser!.messages) {
        const quoted = quoteAwk(message, budget);
        const entry = `msgid ${quoted}\nmsgstr ""\n\n`;
        if (output.length + entry.length > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
        output += entry;
      }
      await write(context, output);
      return 0;
    }
    const hasInspection = inspection.trace !== undefined || inspection.dump !== undefined || inspection.profile !== undefined;
    const observer = hasInspection ? new AwkInspection(context, budget, inspection) : undefined;
    const remainingArgs = index >= context.args.length ? EMPTY_ARGS : context.args.slice(index);
    return new AwkRuntime(program, context, budget, new AwkRetention(options.maxRetainedBytes ?? Infinity, context.signal), remainingArgs, assignments, separator, operandAssignments, ordchr, observer).run();
    })();
  });
}
