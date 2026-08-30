import type { CommandDefinition } from "../../contracts/index.js";
import { AwkParser, decodeString } from "./awk-syntax.js";
import { AwkRuntime } from "./awk-runtime.js";
import { Budget, ProgramError, byteString, command, readProgram, type TextProgramOptions } from "./shared.js";

export function awkCommand(options: TextProgramOptions = {}): CommandDefinition {
  return command("awk", async context => {
    const budget = new Budget(context, options);
    const programs: string[] = [];
    const assignments: string[] = [];
    let separator: string | undefined;
    let index = 0;
    for (; index < context.args.length; index++) {
      const argument = context.args[index]!;
      if (argument === "--") { index++; break; }
      if (argument === "-" || !argument.startsWith("-")) break;
      const flag = argument[1];
      if (flag !== "F" && flag !== "v" && flag !== "f") throw new ProgramError(`unsupported awk option '${argument}'`);
      const value = argument.slice(2) || context.args[++index];
      if (value === undefined) throw new ProgramError(`-${flag} requires an argument`);
      if (flag === "F") separator = decodeString(byteString(value));
      if (flag === "v") {
        if (!/^[A-Za-z_][A-Za-z0-9_]*=/u.test(value)) throw new ProgramError("-v requires a NAME=value assignment");
        assignments.push(byteString(value));
      }
      if (flag === "f") programs.push(await readProgram(context, value));
    }
    if (!programs.length) {
      const program = context.args[index++];
      if (program === undefined) throw new ProgramError("missing awk program");
      programs.push(byteString(program));
    }
    const program = new AwkParser(programs.join("\n")).parse();
    return new AwkRuntime(program, context, budget, context.args.slice(index), assignments, separator).run();
  });
}
