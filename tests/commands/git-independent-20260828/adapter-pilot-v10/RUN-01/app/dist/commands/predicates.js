import {} from "../contracts/index.js";
import { codeOf, define, pathOf, UsageError } from "./internal.js";
async function metadata(context, path, link = false) {
    try {
        return await context.fs[link ? "lstat" : "stat"](pathOf(context, path), { signal: context.signal });
    }
    catch (error) {
        context.signal.throwIfAborted();
        if (["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes(codeOf(error) ?? ""))
            return undefined;
        throw error;
    }
}
export function predicateCommands() {
    return ["test", "["].map(name => define(name, async (context) => {
        const args = [...context.args];
        if (name === "[") {
            if (args.pop() !== "]")
                throw new UsageError("missing ']'");
        }
        if (!args.length)
            return { exitCode: 1 };
        if (args.length === 1)
            return { exitCode: args[0] ? 0 : 1 };
        if (args.length === 2 && args[0] === "!")
            return { exitCode: args[1] ? 1 : 0 };
        const unary = new Set(["-n", "-z", "-e", "-a", "-f", "-d", "-L", "-h", "-s", "-r", "-w", "-x"]);
        const binary = new Set(["=", "==", "!=", "<", ">", "-eq", "-ne", "-lt", "-le", "-gt", "-ge", "-nt", "-ot", "-ef"]);
        let offset = 0;
        const number = (text) => {
            if (!/^[ \t]*[+-]?[0-9]+[ \t]*$/u.test(text))
                throw new UsageError(`integer expression expected: '${text}'`);
            return BigInt(text.trim());
        };
        const primary = () => {
            const token = args[offset++];
            if (token === undefined)
                throw new UsageError("argument expected");
            if (token === "!" && !binary.has(args[offset] ?? "")) {
                const inner = primary();
                return async () => !await inner();
            }
            if (token === "(" && !binary.has(args[offset] ?? "")) {
                const inner = disjunction();
                if (args[offset++] !== ")")
                    throw new UsageError("missing ')'");
                return inner;
            }
            const operator = args[offset];
            if (operator !== undefined && binary.has(operator)) {
                offset++;
                const right = args[offset++];
                if (right === undefined)
                    throw new UsageError("binary operator requires two operands");
                return async () => {
                    if (operator === "=" || operator === "==")
                        return token === right;
                    if (operator === "!=")
                        return token !== right;
                    if (operator === "<")
                        return token < right;
                    if (operator === ">")
                        return token > right;
                    if (["-nt", "-ot", "-ef"].includes(operator)) {
                        const leftStat = await metadata(context, token);
                        const rightStat = await metadata(context, right);
                        if (operator === "-nt")
                            return leftStat !== undefined && (!rightStat || leftStat.mtimeMs > rightStat.mtimeMs);
                        if (operator === "-ot")
                            return rightStat !== undefined && (!leftStat || leftStat.mtimeMs < rightStat.mtimeMs);
                        return leftStat?.ino !== undefined && rightStat?.ino !== undefined && leftStat.ino === rightStat.ino && leftStat.dev === rightStat.dev;
                    }
                    const leftNumber = number(token);
                    const rightNumber = number(right);
                    if (operator === "-eq")
                        return leftNumber === rightNumber;
                    if (operator === "-ne")
                        return leftNumber !== rightNumber;
                    if (operator === "-lt")
                        return leftNumber < rightNumber;
                    if (operator === "-le")
                        return leftNumber <= rightNumber;
                    if (operator === "-gt")
                        return leftNumber > rightNumber;
                    return leftNumber >= rightNumber;
                };
            }
            if (unary.has(token)) {
                const operand = args[offset++];
                if (operand === undefined)
                    throw new UsageError("unary operator requires an operand");
                return async () => {
                    if (token === "-n")
                        return operand !== "";
                    if (token === "-z")
                        return operand === "";
                    if (["-r", "-w", "-x"].includes(token)) {
                        try {
                            await context.fs.access(pathOf(context, operand), token === "-r" ? 4 : token === "-w" ? 2 : 1, { signal: context.signal });
                            return true;
                        }
                        catch (error) {
                            context.signal.throwIfAborted();
                            if (["ENOENT", "ENOTDIR", "EACCES", "EROFS"].includes(codeOf(error) ?? ""))
                                return false;
                            throw error;
                        }
                    }
                    const stat = await metadata(context, operand, token === "-L" || token === "-h");
                    if (!stat)
                        return false;
                    if (token === "-f")
                        return stat.type === "file";
                    if (token === "-d")
                        return stat.type === "directory";
                    if (token === "-L" || token === "-h")
                        return stat.type === "symlink";
                    if (token === "-s")
                        return stat.size > 0;
                    return true;
                };
            }
            return async () => token !== "";
        };
        const conjunction = () => {
            let predicate = primary();
            while (args[offset] === "-a") {
                offset++;
                const left = predicate;
                const right = primary();
                predicate = async () => await left() && await right();
            }
            return predicate;
        };
        const disjunction = () => {
            let predicate = conjunction();
            while (args[offset] === "-o") {
                offset++;
                const left = predicate;
                const right = conjunction();
                predicate = async () => await left() || await right();
            }
            return predicate;
        };
        const evaluate = disjunction();
        if (offset !== args.length)
            throw new UsageError(`unexpected argument '${args[offset]}'`);
        return { exitCode: await evaluate() ? 0 : 1 };
    }));
}
//# sourceMappingURL=predicates.js.map