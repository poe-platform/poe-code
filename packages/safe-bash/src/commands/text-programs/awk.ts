import type { CommandDefinition } from "../../contracts/index.js";
import { AwkParser, builtinArities, decodeString } from "./awk-syntax.js";
import { AwkRuntime } from "./awk-runtime.js";
import { AwkRetention } from "./awk-retention.js";
import { Budget, ProgramError, byteString, command, readProgram, type TextProgramOptions } from "./shared.js";

export function awkCommand(options: TextProgramOptions = {}): CommandDefinition {
  return command("awk", async context => {
    const budget = new Budget(context, options);
    const programs: string[] = [];
    const assignments: string[] = [];
    let separator: string | undefined;
    let hasMain = false;
    let ordchr = false;
    let operandAssignments = true;
    let index = 0;
    for (; index < context.args.length; index++) {
      const argument = context.args[index]!;
      if (argument === "--") { index++; break; }
      if (argument === "-" || !argument.startsWith("-")) break;
      // The runtime already treats strings and records as raw byte strings.
      if (argument === "--characters-as-bytes" || argument === "-b") continue;
      const equals = argument.indexOf("=");
      const option = argument.startsWith("--") ? argument.slice(0, equals < 0 ? undefined : equals) : `-${argument[1]}`;
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
      if (flag === "f" || flag === "E" || flag === "i") programs.push(await readProgram(context, value));
      if (flag === "e") programs.push(byteString(value));
      if (flag === "f" || flag === "e" || flag === "E") hasMain = true;
      if (flag === "E") { operandAssignments = false; index++; break; }
    }
    if (!hasMain) {
      const program = context.args[index++];
      if (program === undefined) throw new ProgramError("missing awk program");
      programs.push(byteString(program));
    }
    const arities = ordchr ? { ...builtinArities, ord: [1, 1] as const, chr: [1, 1] as const } : builtinArities;
    const program = new AwkParser(programs.join("\n"), arities).parse();
    return new AwkRuntime(program, context, budget, new AwkRetention(32 * 1024 * 1024, context.signal), context.args.slice(index), assignments, separator, operandAssignments, ordchr).run();
  });
}
