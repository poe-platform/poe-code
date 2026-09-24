import { FsError, type CommandContext, type CommandDefinition, type FileStat } from "../contracts/index.js";
import { codeOf, define, pathOf, UsageError } from "./internal.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { predicateRequirements } from "./portable-requirements.js";
import { evaluateFilePredicate, type PredicateIdentity } from "./file-predicates.js";

import { variablePresence } from "./variable-presence.js";

type Predicate = () => Promise<boolean>;

const maxExpressionDepth = 256;

async function metadata(context: CommandContext, path: string, link = false): Promise<FileStat | undefined> {
  assertCommandRequirements(context, predicateRequirements, ["metadata"]);
  try {
    // The non-mutating exclusive query preserves the final link, matching lstat.
    if (context.fs.capabilitiesFor) assertCommandRequirements(context, predicateRequirements, ["metadata"],
      await context.fs.capabilitiesFor(pathOf(context, path), { signal: context.signal, ...(link ? { creation: "exclusive" as const } : {}) }));
    return await context.fs[link ? "lstat" : "stat"](pathOf(context, path), { signal: context.signal });
  }
  catch (error) {
    context.signal.throwIfAborted();
    if (["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes(codeOf(error) ?? "")) return undefined;
    throw error;
  }
}

export function predicateCommands(identity: { readonly effectiveUid?: number; readonly effectiveGid?: number } = {}): CommandDefinition[] {
  for (const id of [identity.effectiveUid, identity.effectiveGid]) {
    if (id !== undefined && (!Number.isSafeInteger(id) || id < 0)) throw new TypeError("caller identity must be a nonnegative safe integer");
  }
  identity = { ...identity };
  return ["test", "["].map(name => define(name, async context => {
    const args = [...context.args];
    if (name === "[") {
      if (args.pop() !== "]") throw new UsageError("missing ']'");
    }
    const unary = new Set(["-n", "-z", "-e", "-a", "-f", "-d", "-c", "-L", "-h", "-s", "-r", "-w", "-x", "-b", "-p", "-S", "-u", "-g", "-k", "-O", "-G", "-t", "-v", "-o", "-R", "-N"]);
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
      // A short group treats operator-looking strings as operands by argc.
      if (args.length > 3 && token === "(" && args[offset + 1] === ")") {
        if (depth >= maxExpressionDepth) throw new UsageError(`expression nesting exceeds ${maxExpressionDepth}`);
        const value = Boolean(args[offset]);
        offset += 2;
        return async () => value;
      }
      if (token === "(" && args[offset] === "!" && args[offset + 2] === ")") {
        if (depth >= maxExpressionDepth) throw new UsageError(`expression nesting exceeds ${maxExpressionDepth}`);
        const value = !args[offset + 1];
        offset += 3;
        return async () => value;
      }
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
          if (operator === "<" || operator === ">") {
            const order = Buffer.compare(Buffer.from(token), Buffer.from(right));
            return operator === "<" ? order < 0 : order > 0;
          }
          if (["-nt", "-ot", "-ef"].includes(operator)) {
            return evaluateFilePredicate(context, operator, token, right);
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
          if (token === "-v") {
            const present = context.shellPredicates && variablePresence.get(context.shellPredicates);
            if (!present) throw new UsageError("variable predicate requires shell state");
            return present(operand);
          }
          if (["-R", "-o", "-t"].includes(token)) {
            const state = context.shellPredicates;
            if (!state) throw new FsError("ENOTSUP", { message: "caller shell predicate state is unavailable" });
            if (token === "-R") return state.reference(operand);
            if (token === "-o") return state.option(operand);
            const descriptor = Number(operand);
            return /^[ \t]*[+]?[0-9]+[ \t]*$/u.test(operand) && Number.isSafeInteger(descriptor) && descriptor >= 0 && state.terminal(descriptor);
          }
          if (["-r", "-w", "-x"].includes(token)) {
            assertCommandRequirements(context, predicateRequirements, ["access"]);
            try {
              if (context.fs.capabilitiesFor) assertCommandRequirements(context, predicateRequirements, ["access"],
                await context.fs.capabilitiesFor(pathOf(context, operand), { signal: context.signal }));
              await context.fs.access(pathOf(context, operand), token === "-r" ? 4 : token === "-w" ? 2 : 1, { signal: context.signal });
              return true;
            }
            catch (error) { context.signal.throwIfAborted(); if (["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP", "EROFS"].includes(codeOf(error) ?? "")) return false; throw error; }
          }
          if (["-b", "-p", "-S", "-u", "-g", "-k", "-O", "-G", "-N"].includes(token)) {
            return evaluateFilePredicate(context, token, operand, undefined, context.capabilities?.predicateIdentity as PredicateIdentity | undefined ?? identity);
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
