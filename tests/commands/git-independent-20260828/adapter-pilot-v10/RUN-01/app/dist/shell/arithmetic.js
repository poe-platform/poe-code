import { ShellSyntaxError } from "./types.js";
class ArithmeticFailure extends Error {
    offset;
    constructor(message, offset) {
        super(message);
        this.offset = offset;
    }
}
export function prepareArithmetic(source) {
    try {
        return { source, tree: parseArithmetic(source) };
    }
    catch (error) {
        if (!(error instanceof ShellSyntaxError) || /nesting/u.test(error.reason))
            throw error;
        return { source, error };
    }
}
const precedence = {
    ",": 1, "=": 2, "+=": 2, "-=": 2, "*=": 2, "/=": 2, "%=": 2,
    "<<=": 2, ">>=": 2, "&=": 2, "^=": 2, "|=": 2,
    "?": 3, "||": 4, "&&": 5, "|": 6, "^": 7, "&": 8,
    "==": 9, "!=": 9, "<": 10, "<=": 10, ">": 10, ">=": 10,
    "<<": 11, ">>": 11, "+": 12, "-": 12, "*": 13, "/": 13, "%": 13, "**": 14,
};
function integer(text) {
    if (/^0[xX][\da-fA-F]+$/u.test(text))
        return BigInt(text);
    if (/^0[0-7]+$/u.test(text))
        return BigInt(`0o${text.slice(1)}`);
    if (/^0\d+$/u.test(text))
        throw new Error("Invalid octal constant");
    if (/^\d+$/u.test(text))
        return BigInt(text);
    const match = /^(\d+)#([\da-zA-Z@_]+)$/u.exec(text);
    if (!match)
        throw new Error("Invalid arithmetic constant");
    const base = Number(match[1]);
    if (base < 2 || base > 64)
        throw new Error("Invalid arithmetic base");
    let value = 0n;
    for (const character of match[2]) {
        const digit = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ@_".indexOf(base <= 36 ? character.toLowerCase() : character);
        if (digit >= base || digit < 0)
            throw new Error("Digit exceeds arithmetic base");
        value = value * BigInt(base) + BigInt(digit);
    }
    return value;
}
export function parseArithmetic(source, offset = 0) {
    const tokens = [];
    let position = 0;
    while (position < source.length) {
        if (/\s/u.test(source[position])) {
            position++;
            continue;
        }
        const value = /^(?:\d+#[\da-zA-Z@_]+|0[xX][\da-fA-F]+|\d+|[a-zA-Z_][a-zA-Z_0-9]*|<<=|>>=|\*\*|\+\+|--|&&|\|\||<<|>>|[+*/%&^|!<>=-]=|[()+*/%~!<>=&^|?:,\-])/u.exec(source.slice(position))?.[0];
        if (!value)
            throw new ShellSyntaxError("Unsupported arithmetic token", offset + position);
        tokens.push({ value, offset: offset + position });
        position += value.length;
    }
    let cursor = 0;
    let depth = 0;
    const current = () => tokens[cursor]?.value ?? "";
    const error = (message) => { throw new ShellSyntaxError(message, tokens[cursor]?.offset ?? offset + source.length); };
    const expression = (minimum = 1) => {
        if (++depth > 64)
            error("Arithmetic nesting exceeds 64");
        let left;
        const start = tokens[cursor]?.offset ?? offset + source.length;
        const token = current();
        cursor++;
        if (["+", "-", "!", "~", "++", "--"].includes(token)) {
            const operand = expression(15);
            if (["++", "--"].includes(token) && operand.kind !== "name")
                error("Arithmetic assignment requires a variable");
            left = { kind: "unary", operator: token, operand, postfix: false };
        }
        else if (token === "(") {
            left = expression();
            if (current() !== ")")
                error("Unclosed arithmetic parenthesis");
            cursor++;
        }
        else if (/^[a-zA-Z_]/u.test(token))
            left = { kind: "name", name: token };
        else {
            try {
                left = { kind: "literal", value: BigInt.asIntN(64, integer(token)) };
            }
            catch {
                error("Invalid arithmetic operand");
            }
        }
        left.start = start;
        while (true) {
            const operator = current();
            if (operator === "++" || operator === "--") {
                if (left.kind !== "name")
                    error("Arithmetic assignment requires a variable");
                cursor++;
                left = { kind: "unary", operator, operand: left, postfix: true, start };
                continue;
            }
            const priority = Object.hasOwn(precedence, operator) ? precedence[operator] : 0;
            if (priority < minimum || priority === 0)
                break;
            cursor++;
            if (operator === "?") {
                const yes = expression();
                if (current() !== ":")
                    error("Expected arithmetic colon");
                cursor++;
                left = { kind: "conditional", condition: left, yes, no: expression(3), start };
            }
            else {
                const assignment = priority === 2;
                if (assignment && left.kind !== "name")
                    error("Arithmetic assignment requires a variable");
                const right = expression(priority + (assignment || operator === "**" ? 0 : 1));
                left = { kind: "binary", operator, left: left, right, start };
            }
        }
        depth--;
        return left;
    };
    if (!tokens.length)
        return { kind: "literal", value: 0n };
    const tree = expression();
    if (cursor < tokens.length)
        error("Unexpected arithmetic token");
    return tree;
}
export function arithmeticEnd(source, start) {
    let depth = 0;
    for (let position = start; position < source.length; position++) {
        const character = source[position];
        if (character === "(")
            depth++;
        if (character === ")") {
            if (depth === 0 && source[position + 1] === ")")
                return position;
            if (--depth < 0)
                break;
        }
    }
    throw new ShellSyntaxError("Unterminated arithmetic expression", start);
}
export function evaluateArithmetic(program, variables) {
    const visiting = new Set();
    let steps = 0;
    const binary = (operator, left, right, offset) => {
        switch (operator) {
            case "+": return left + right;
            case "-": return left - right;
            case "*": return left * right;
            case "/":
                if (right === 0n)
                    throw new ArithmeticFailure("division by 0", offset);
                return left / right;
            case "%":
                if (right === 0n)
                    throw new ArithmeticFailure("division by 0", offset);
                return left % right;
            case "**": {
                if (right < 0n)
                    throw new ArithmeticFailure("exponent less than 0", offset);
                let result = 1n;
                let base = left;
                let exponent = right;
                while (exponent) {
                    if (exponent & 1n)
                        result = BigInt.asIntN(64, result * base);
                    exponent >>= 1n;
                    base = BigInt.asIntN(64, base * base);
                }
                return result;
            }
            case "<<": return left << (right & 63n);
            case ">>": return left >> (right & 63n);
            case "&": return left & right;
            case "|": return left | right;
            case "^": return left ^ right;
            case "==": return BigInt(left === right);
            case "!=": return BigInt(left !== right);
            case "<": return BigInt(left < right);
            case "<=": return BigInt(left <= right);
            case ">": return BigInt(left > right);
            case ">=": return BigInt(left >= right);
            default: throw new Error(`Unsupported arithmetic operator ${operator}`);
        }
    };
    const evaluate = (node) => {
        if (++steps > 10_000)
            throw new Error("Arithmetic operation limit exceeded");
        let value;
        if (node.kind === "literal")
            return node.value;
        if (node.kind === "name") {
            if (visiting.has(node.name) || visiting.size >= 64)
                throw new Error("Arithmetic variable recursion");
            visiting.add(node.name);
            try {
                return evaluate(parseArithmetic(variables[node.name] ?? "0"));
            }
            finally {
                visiting.delete(node.name);
            }
        }
        if (node.kind === "conditional")
            return evaluate(evaluate(node.condition) ? node.yes : node.no);
        if (node.kind === "unary") {
            const operand = evaluate(node.operand);
            if (node.operator === "+")
                value = operand;
            else if (node.operator === "-")
                value = -operand;
            else if (node.operator === "!")
                value = BigInt(!operand);
            else if (node.operator === "~")
                value = ~operand;
            else {
                value = BigInt.asIntN(64, operand + (node.operator === "++" ? 1n : -1n));
                variables[node.operand.name] = String(value);
                if (node.postfix)
                    value = operand;
            }
        }
        else {
            if (node.operator === "=")
                value = evaluate(node.right);
            else {
                const left = evaluate(node.left);
                if (node.operator === "&&")
                    return left ? BigInt(evaluate(node.right) !== 0n) : 0n;
                if (node.operator === "||")
                    return left ? 1n : BigInt(evaluate(node.right) !== 0n);
                if (node.operator === ",")
                    return evaluate(node.right);
                value = binary(precedence[node.operator] === 2 ? node.operator.slice(0, -1) : node.operator, left, evaluate(node.right), node.right.start ?? 0);
            }
            if (precedence[node.operator] === 2)
                variables[node.left.name] = String(BigInt.asIntN(64, value));
        }
        return BigInt.asIntN(64, value);
    };
    try {
        if (program.error)
            throw program.error;
        return evaluate(program.tree);
    }
    catch (error) {
        if (error instanceof ArithmeticFailure)
            throw new Error(`${program.source.trimStart()}: ${error.message} (error token is "${program.source.slice(error.offset)}")`);
        if (error instanceof ShellSyntaxError) {
            const offset = error.offset >= program.source.trimEnd().length ? Math.max(0, program.source.trimEnd().length - 1) : error.offset;
            const reason = error.reason === "Invalid arithmetic operand" ? "arithmetic syntax error: operand expected" : "arithmetic syntax error in expression";
            throw new Error(`${program.source.trimStart()}: ${reason} (error token is "${program.source.slice(offset)}")`);
        }
        throw error;
    }
}
//# sourceMappingURL=arithmetic.js.map