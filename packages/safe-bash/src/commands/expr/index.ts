import { writeBytes, type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";
import { RegexExecutor, RegexExecutionError, withRegexSession } from "../regex-execution/client.js";
import { ExprMatchError, exprMatchCeilings } from "../regex-execution/protocol.js";
import { bytes, characterCount, smallInteger, truth } from "./evaluate.js";
import { Budget, ExprError, screenMatch, settings, type ExprCommandsOptions } from "./internal.js";
import { evaluateExpression } from "./syntax.js";

export type { ExprCommandsOptions, ExprLimits } from "./internal.js";

const help = "Usage: expr EXPRESSION\nTokens: | & < <= = == != >= > + - * / % :\nPrefixes: + TOKEN, length STRING, index STRING CHARS, substr STRING POS LENGTH, match STRING REGEXP\nGroup with ( EXPRESSION ). Each token is a separate argument.\nMatching uses bounded worker-only BRE in C/POSIX byte or C.UTF-8 scalar profiles.\n";

export function createExprCommand(options: ExprCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  const executor = new RegexExecutor(options.regex);
  return { name: "expr", description: "Evaluate bounded integer and string expressions", async execute(context) {
    return withRegexSession(context, executor, async session => {
      context.signal.throwIfAborted();
      const budget = new Budget(context, limits);
      let output: Uint8Array;
      let exitCode = 0;
      try {
        budget.arguments();
        if (context.args.length === 1 && ["--help", "--version"].includes(context.args[0]!)) {
          const text = context.args[0] === "--help" ? help : "expr (virtual-bash)\n";
          budget.check(Buffer.byteLength(text), limits.maxOutputBytes, "output bytes");
          output = budget.encode(text);
        } else {
          const value = await evaluateExpression(context.args, budget, async (subject, pattern, unicode) => {
            budget.charge();
            screenMatch(subject, pattern, budget);
            if (budget.remaining() < 1) throw new ExprError("evaluation work limit exceeded", 3);
            const result = await session.matchExpr({ kind: "expr-match", pattern, profile: unicode ? "utf8-scalar" : "byte", limits: {
              maxPatternBytes: limits.maxRegexPatternBytes,
              maxSubjectBytes: Math.min(limits.maxStringBytes, exprMatchCeilings.maxSubjectBytes),
              maxNodes: limits.maxRegexNodes, maxDepth: limits.maxRegexDepth,
              maxSteps: Math.min(budget.remaining(), exprMatchCeilings.maxSteps),
              maxStates: limits.maxRegexStates, maxAllocatedUnits: limits.maxRegexAllocatedUnits,
            } }, subject);
            budget.charge(result.steps);
            if (result.hasCapture) {
              const start = result.capture?.start ?? 0, end = result.capture?.end ?? 0;
              budget.allocation(end - start);
              return new Uint8Array(subject.subarray(start, end));
            }
            return smallInteger(characterCount(subject.subarray(0, result.overall?.end ?? 0), budget, unicode), budget);
          }, context.args[0] === "--" ? 1 : 0);
          exitCode = truth(value, budget) ? 0 : 1;
          const result = bytes(value, budget);
          budget.check(result.length + 1, limits.maxOutputBytes, "output bytes");
          budget.charge(result.length + 1);
          output = new Uint8Array(result.length + 1);
          output.set(result);
          output[result.length] = 10;
        }
        await budget.yield();
      } catch (error) {
        context.signal.throwIfAborted();
        const message = error instanceof ExprError || error instanceof ExprMatchError || error instanceof RegexExecutionError ? error.message : "execution or output failure";
        try {
          budget.check(message.length + 7, limits.maxOutputBytes, "output bytes");
          budget.check(Buffer.byteLength(message) + 7, limits.maxOutputBytes, "output bytes");
        } catch {
          await writeBytes(context.stderr, new TextEncoder().encode("expr: output bytes limit exceeded\n"), context.signal);
          return { exitCode: 3 };
        }
        await writeBytes(context.stderr, new TextEncoder().encode(`expr: ${message}\n`), context.signal);
        return { exitCode: error instanceof ExprError ? error.exitCode : error instanceof ExprMatchError && error.category !== "limit" ? 2 : 3 };
      }
      await writeBytes(context.stdout, output, context.signal);
      return { exitCode };
    });
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
