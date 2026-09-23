import { type CommandContext, type CommandDefinition, type FileStat } from "../contracts/index.js";
import { codeOf, define, pathOf, UsageError } from "./internal.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { predicateRequirements } from "./portable-requirements.js";
import { compareCopyIdentity } from "./copy-identity.js";

type Predicate = () => Promise<boolean>;

const maxExpressionDepth = 256;

async function metadata(context: CommandContext, path: string, link = false): Promise<FileStat | undefined> {
  assertCommandRequirements(context, predicateRequirements, ["metadata"]);
  try {
    if (context.fs.capabilitiesFor) assertCommandRequirements(context, predicateRequirements, ["metadata"],
      await context.fs.capabilitiesFor(pathOf(context, path), { signal: context.signal }));
    return await context.fs[link ? "lstat" : "stat"](pathOf(context, path), { signal: context.signal });
  }
  catch (error) {
    context.signal.throwIfAborted();
    if (["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes(codeOf(error) ?? "")) return undefined;
    throw error;
  }
}

export function predicateCommands(): CommandDefinition[] {
  return ["test", "["].map(name => define(name, async context => {
    const args = [...context.args];
    if (name === "[") {
      if (args.pop() !== "]") throw new UsageError("missing ']'");
    }
    const unary = new Set(["-n", "-z", "-e", "-a", "-f", "-d", "-c", "-L", "-h", "-s", "-r", "-w", "-x"]);
    const binary = new Set(["=", "==", "!=", "<", ">", "-eq", "-ne", "-lt", "-le", "-gt", "-ge", "-nt", "-ot", "-ef"]);
    const numeric = new Set(["-eq", "-ne", "-lt", "-le", "-gt", "-ge"]);
    // Small expressions use argc rules before recursive operator precedence.
    let negate = false;
    if (args.length === 4) {
      if (args[0] === "!") { negate = true; args.shift(); }
      else if (args[0] === "(" && args[3] === ")") { args.pop(); args.shift(); }
    }
    if (args.length === 3 && !binary.has(args[1]!)) {
      if (args[1] === "-a" || args[1] === "-o") {
        const value = args[1] === "-a" ? Boolean(args[0]) && Boolean(args[2]) : Boolean(args[0]) || Boolean(args[2]);
        return { exitCode: value !== negate ? 0 : 1 };
      }
      if (args[0] === "!") { negate = !negate; args.shift(); }
      else if (args[0] === "(" && args[2] === ")") { args.pop(); args.shift(); }
    }
    if (args.length === 2 && args[0] === "!") { negate = !negate; args.shift(); }
    if (args.length < 2) return { exitCode: Boolean(args[0]) !== negate ? 0 : 1 };
    let offset = 0;
    const number = (text: string): bigint => {
      if (!/^[ \t]*[+-]?[0-9]+[ \t]*$/u.test(text)) throw new UsageError(`integer expression expected: '${text}'`);
      return BigInt(text.trim());
    };
    const primary = (depth: number): Predicate => {
      const token = args[offset++];
      if (token === undefined) throw new UsageError("argument expected");
      if ((token === "!" || token === "(") && !binary.has(args[offset] ?? "")) {
        if (depth >= maxExpressionDepth) throw new UsageError(`expression nesting exceeds ${maxExpressionDepth}`);
        if (token === "!") { const inner = primary(depth + 1); return async () => !await inner(); }
        const inner = disjunction(depth + 1);
        if (args[offset++] !== ")") throw new UsageError("missing ')'");
        return inner;
      }
      const leftLength = token === "-l" && numeric.has(args[offset + 1] ?? "");
      const left = leftLength ? args[offset++]! : token;
      const operator = args[offset];
      if (operator !== undefined && binary.has(operator)) {
        offset++;
        const rightLength = numeric.has(operator) && args[offset] === "-l";
        if (rightLength) offset++;
        const right = args[offset++];
        if (right === undefined) throw new UsageError("binary operator requires two operands");
        return async () => {
          if (operator === "=" || operator === "==") return token === right;
          if (operator === "!=") return token !== right;
          if (operator === "<") return token < right;
          if (operator === ">") return token > right;
          if (["-nt", "-ot", "-ef"].includes(operator)) {
            const leftStat = await metadata(context, token);
            const rightStat = await metadata(context, right);
            if (operator === "-nt") return leftStat !== undefined && (!rightStat || leftStat.mtimeMs > rightStat.mtimeMs);
            if (operator === "-ot") return rightStat !== undefined && (!leftStat || leftStat.mtimeMs < rightStat.mtimeMs);
            const identity = compareCopyIdentity(leftStat, rightStat);
            if (identity !== "unknown") return identity === "same";
            return leftStat?.ino !== undefined && rightStat?.ino !== undefined && leftStat.type === rightStat.type && leftStat.ino === rightStat.ino && leftStat.dev === rightStat.dev;
          }
          const leftNumber = leftLength ? BigInt(new TextEncoder().encode(left).byteLength) : number(left);
          const rightNumber = rightLength ? BigInt(new TextEncoder().encode(right).byteLength) : number(right);
          if (operator === "-eq") return leftNumber === rightNumber;
          if (operator === "-ne") return leftNumber !== rightNumber;
          if (operator === "-lt") return leftNumber < rightNumber;
          if (operator === "-le") return leftNumber <= rightNumber;
          if (operator === "-gt") return leftNumber > rightNumber;
          return leftNumber >= rightNumber;
        };
      }
      if (unary.has(token)) {
        const operand = args[offset++];
        if (operand === undefined) throw new UsageError("unary operator requires an operand");
        return async () => {
          if (token === "-n") return operand !== "";
          if (token === "-z") return operand === "";
          if (["-r", "-w", "-x"].includes(token)) {
            assertCommandRequirements(context, predicateRequirements, ["access"]);
            try {
              if (context.fs.capabilitiesFor) assertCommandRequirements(context, predicateRequirements, ["access"],
                await context.fs.capabilitiesFor(pathOf(context, operand), { signal: context.signal }));
              await context.fs.access(pathOf(context, operand), token === "-r" ? 4 : token === "-w" ? 2 : 1, { signal: context.signal });
              return true;
            }
            catch (error) { context.signal.throwIfAborted(); if (["ENOENT", "ENOTDIR", "EACCES", "EROFS"].includes(codeOf(error) ?? "")) return false; throw error; }
          }
          const stat = await metadata(context, operand, token === "-L" || token === "-h");
          if (!stat) return false;
          if (token === "-f") return stat.type === "file";
          if (token === "-c") return stat.type === "character";
          if (token === "-d") return stat.type === "directory";
          if (token === "-L" || token === "-h") return stat.type === "symlink";
          if (token === "-s") return stat.size > 0;
          return true;
        };
      }
      return async () => token !== "";
    };
    const conjunction = (depth: number): Predicate => {
      let predicate = primary(depth);
      while (args[offset] === "-a") {
        offset++;
        const left = predicate;
        const right = primary(depth);
        predicate = async () => await left() && await right();
      }
      return predicate;
    };
    const disjunction = (depth: number): Predicate => {
      let predicate = conjunction(depth);
      while (args[offset] === "-o") {
        offset++;
        const left = predicate;
        const right = conjunction(depth);
        predicate = async () => await left() || await right();
      }
      return predicate;
    };
    const evaluate = disjunction(0);
    if (offset !== args.length) throw new UsageError(`unexpected argument '${args[offset]}'`);
    return { exitCode: await evaluate() !== negate ? 0 : 1 };
  })).map(command => ({ ...command, filesystemRequirements: predicateRequirements }));
}
