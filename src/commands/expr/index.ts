import { writeBytes, type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";
import { policy } from "../regex-execution/protocol.js";
import { bytes, evaluate, truth } from "./evaluate.js";
import { Budget, ExprError, settings, type ExprCommandsOptions } from "./internal.js";
import { parse } from "./syntax.js";

export type { ExprCommandsOptions, ExprLimits } from "./internal.js";

const help = "Usage: expr EXPRESSION\nTokens: | & < <= = == != >= > + - * / % :\nPrefixes: + TOKEN, length STRING, index STRING CHARS, substr STRING POS LENGTH, match STRING REGEXP\nGroup with ( EXPRESSION ). Each token is a separate argument.\nCheckpoint: evaluated match/: require the pending bounded BRE protocol.\n";

export function createExprCommand(options: ExprCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  policy(options.regex ?? {});
  return { name: "expr", description: "Evaluate bounded integer and string expressions", async execute(context) {
    context.signal.throwIfAborted();
    const budget = new Budget(context, limits);
    try {
      budget.arguments();
      let output: Uint8Array;
      let exitCode = 0;
      if (context.args.length === 1 && ["--help", "--version"].includes(context.args[0]!)) {
        const text = context.args[0] === "--help" ? help : "expr (virtual-bash)\n";
        budget.check(Buffer.byteLength(text), limits.maxOutputBytes, "output bytes");
        output = budget.encode(text);
      } else {
        const tree = parse(context.args, budget, context.args[0] === "--" ? 1 : 0);
        const value = await evaluate(tree, budget, async () => { throw new ExprError("bounded expr BRE protocol is pending", 3); });
        exitCode = truth(value, budget) ? 0 : 1;
        const result = bytes(value, budget);
        budget.check(result.length + 1, limits.maxOutputBytes, "output bytes");
        budget.charge(result.length + 1);
        output = new Uint8Array(result.length + 1);
        output.set(result);
        output[result.length] = 10;
      }
      await budget.yield();
      await writeBytes(context.stdout, output, context.signal);
      return { exitCode };
    } catch (error) {
      context.signal.throwIfAborted();
      const message = error instanceof ExprError ? error.message : "execution or output failure";
      await writeBytes(context.stderr, new TextEncoder().encode(`expr: ${message}\n`), context.signal);
      return { exitCode: error instanceof ExprError ? error.exitCode : 3 };
    }
  } };
}

export function createExprCommands(options: ExprCommandsOptions = {}): readonly CommandDefinition[] {
  return [createExprCommand(options)];
}

export function exprCommands(options: ExprCommandsOptions = {}): VirtualShellPlugin {
  const commands = createExprCommands(options);
  return { name: "expr-commands", setup(host) {
    if (!options.replace && host.commands.has("expr")) throw new Error("Command already registered: expr");
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
