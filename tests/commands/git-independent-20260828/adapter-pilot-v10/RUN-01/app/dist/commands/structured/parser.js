import { JqError, JqLimitError, wellFormed } from "./limits.js";
import { decimalNumber } from "./numbers.js";
const precedence = Object.freeze({
    "|": 1, ",": 2, "=": 3, "|=": 3, "+=": 3, "-=": 3, "*=": 3, "/=": 3, "%=": 3, "//=": 3,
    "//": 4, or: 5, and: 6, "==": 7, "!=": 7, "<": 7, ">": 7, "<=": 7, ">=": 7,
    "+": 8, "-": 8, "*": 9, "/": 9, "%": 9,
});
export const functions = Object.freeze({
    empty: [0], select: [1], map: [1], map_values: [1], length: [0], keys: [0], keys_unsorted: [0], values: [0],
    type: [0], has: [1], contains: [1], sort: [0], sort_by: [1], unique: [0], unique_by: [1], group_by: [1], add: [0],
    not: [0], reverse: [0], first: [0, 1], last: [0, 1], limit: [2], range: [1, 2, 3], join: [1], split: [1],
    tostring: [0], tonumber: [0], tojson: [0], fromjson: [0], to_entries: [0], from_entries: [0], with_entries: [1],
    min: [0], max: [0], min_by: [1], max_by: [1], any: [0, 1, 2], all: [0, 1, 2],
    strings: [0], numbers: [0], booleans: [0], arrays: [0], objects: [0], nulls: [0], scalars: [0], iterables: [0],
    nan: [0], infinite: [0], isnan: [0], isinfinite: [0], isfinite: [0],
});
function tokenize(source) {
    const tokens = [];
    let offset = 0;
    while (offset < source.length) {
        const character = source[offset];
        if (/\s/u.test(character)) {
            offset++;
            continue;
        }
        if (character === "#") {
            while (offset < source.length && source[offset] !== "\n")
                offset++;
            continue;
        }
        const start = offset;
        if (character === '"') {
            offset++;
            let escaped = false;
            while (offset < source.length) {
                const current = source[offset++];
                if (!escaped && current === '"')
                    break;
                if (!escaped && current === "\\")
                    escaped = true;
                else
                    escaped = false;
            }
            const text = source.slice(start, offset).replace(/[\x00-\x1f]/gu, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
            try {
                if (!wellFormed(JSON.parse(text)))
                    throw new Error();
            }
            catch {
                throw new JqError(`invalid string at offset ${start}`, 3);
            }
            tokens.push({ text, offset: start, kind: "string" });
            continue;
        }
        const number = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/u.exec(source.slice(offset));
        if (number) {
            tokens.push({ text: number[0], offset, kind: "number" });
            offset += number[0].length;
            continue;
        }
        const name = /^[A-Za-z_][A-Za-z_0-9]*/u.exec(source.slice(offset));
        if (name) {
            tokens.push({ text: name[0], offset, kind: "name" });
            offset += name[0].length;
            continue;
        }
        const symbol = /^(?:\/\/=|\|=|\+=|-=|\*=|\/=|%=|==|!=|<=|>=|\/\/|[.\[\]{}(),:;?$|+*/%<>=-])/u.exec(source.slice(offset));
        if (!symbol)
            throw new JqError(`unexpected character at offset ${offset}`, 3);
        tokens.push({ text: symbol[0], offset, kind: "symbol" });
        offset += symbol[0].length;
    }
    tokens.push({ text: "", offset, kind: "end" });
    return tokens;
}
function isPath(ast) {
    const pending = [ast];
    while (pending.length) {
        const node = pending.pop();
        if (node.kind === "identity")
            continue;
        if (node.kind === "index" || node.kind === "iterate")
            pending.push(node.base);
        else if (node.kind === "binary" && node.operator === ",")
            pending.push(node.left, node.right);
        else
            return false;
    }
    return true;
}
export function parse(source, variables, budget) {
    const limits = budget.limits;
    if (Buffer.byteLength(source) > limits.maxSourceBytes)
        throw new JqLimitError("maxSourceBytes");
    const tokens = tokenize(source);
    let position = 0;
    let nesting = 0;
    const unresolved = new Map();
    const peek = () => tokens[Math.min(position, tokens.length - 1)];
    const take = () => { const token = peek(); if (token.kind !== "end")
        position++; return token; };
    const accept = (text) => { if (peek().text !== text)
        return false; take(); return true; };
    const fail = (message) => { throw new JqError(`${message} at offset ${peek().offset}`, 3); };
    const diagnostic = (token, message) => {
        const prefix = source.slice(0, token.offset);
        const line = prefix.split("\n").length;
        const start = prefix.lastIndexOf("\n") + 1;
        const end = source.indexOf("\n", start);
        const context = source.slice(start, end < 0 ? source.length : end);
        return `error: ${message} at <top-level>, line ${line}:\n${context}${" ".repeat(Buffer.byteLength(prefix.slice(start)))}`;
    };
    const syntaxError = (token, expectEnd = false) => {
        const name = token.kind === "end" ? "end of file" : token.kind === "name" ? "IDENT" : token.kind === "number" || token.kind === "string" ? "LITERAL" : `'${token.text}'`;
        const location = token.kind === "end" ? tokens[Math.max(0, position - 1)] : token;
        throw new JqError(`${diagnostic(location, `syntax error, unexpected ${name}${expectEnd ? ", expecting end of file" : ""} (Unix shell quoting issues?)`)}\njq: 1 compile error`, 3);
    };
    const expect = (text) => { if (!accept(text))
        fail(`expected '${text}'`); };
    const literal = (value) => ({ kind: "literal", value });
    const conditional = () => {
        const condition = expression();
        expect("then");
        const yes = expression();
        if (accept("elif"))
            return { kind: "if", condition, yes, no: guardedConditional() };
        expect("else");
        const no = expression();
        expect("end");
        return { kind: "if", condition, yes, no };
    };
    const guardedConditional = () => {
        if (++nesting > limits.maxAstDepth)
            throw new JqLimitError("maxAstDepth");
        try {
            return conditional();
        }
        finally {
            nesting--;
        }
    };
    const expression = (minimum = 0, stopComma = false) => {
        if (++nesting > limits.maxAstDepth)
            throw new JqLimitError("maxAstDepth");
        try {
            let left = primary();
            while (true) {
                const operator = peek().text;
                const priority = Object.hasOwn(precedence, operator) ? precedence[operator] : -1;
                if (priority < minimum || (stopComma && operator === ","))
                    break;
                take();
                const assignment = priority === 3;
                if (assignment && !isPath(left))
                    fail("unsupported assignment path");
                const right = expression(priority + (assignment ? 0 : 1), stopComma);
                left = { kind: "binary", operator, left, right };
            }
            return left;
        }
        finally {
            nesting--;
        }
    };
    const primary = () => {
        const token = take();
        let result;
        if (token.text === ".") {
            result = { kind: "identity" };
            if ((peek().kind === "name" && peek().offset === token.offset + 1) || peek().kind === "string") {
                const key = take();
                result = { kind: "index", base: result, index: literal(key.kind === "string" ? JSON.parse(key.text) : key.text) };
            }
        }
        else if (token.text === "(") {
            result = expression();
            expect(")");
        }
        else if (token.text === "[") {
            result = { kind: "array", body: peek().text === "]" ? undefined : expression() };
            expect("]");
        }
        else if (token.text === "{") {
            const fields = [];
            if (peek().text !== "}")
                do {
                    const keyToken = take();
                    let key;
                    if (keyToken.text === "(") {
                        key = expression();
                        expect(")");
                    }
                    else if (keyToken.kind === "string" || keyToken.kind === "name")
                        key = literal(keyToken.kind === "string" ? JSON.parse(keyToken.text) : keyToken.text);
                    else
                        fail("expected object key");
                    const value = accept(":") ? expression(0, true) : key.kind === "literal" ? { kind: "index", base: { kind: "identity" }, index: key } : fail("expected ':'");
                    fields.push({ key: key, value });
                } while (accept(","));
            expect("}");
            result = { kind: "object", fields };
        }
        else if (token.text === "$") {
            const name = take();
            if (name.kind !== "name")
                fail("expected variable name");
            if (!variables.has(name.text))
                fail(`undefined variable $${name.text}`);
            result = { kind: "variable", name: name.text };
        }
        else if (token.text === "-")
            result = { kind: "unary", operand: expression(10) };
        else if (token.text === "if")
            result = guardedConditional();
        else if (token.kind === "string")
            result = literal(JSON.parse(token.text));
        else if (token.kind === "number") {
            result = literal(decimalNumber(token.text, budget));
        }
        else if (["true", "false", "null"].includes(token.text))
            result = literal(JSON.parse(token.text));
        else if (token.kind === "name") {
            const args = [];
            if (accept("(")) {
                if (peek().text !== ")")
                    do {
                        args.push(expression());
                    } while (accept(";"));
                expect(")");
            }
            if (token.text === "split" && args.length === 2)
                fail("unsupported function split/2");
            result = { kind: "call", name: token.text, args };
            if (!Object.hasOwn(functions, token.text) || !functions[token.text].includes(args.length))
                unresolved.set(result, token);
        }
        else
            syntaxError(token, nesting === 1);
        while (true) {
            if (accept("?"))
                result = { kind: "optional", operand: result };
            else if (accept(".")) {
                const key = take();
                if (key.kind !== "name" && key.kind !== "string")
                    fail("expected property name");
                result = { kind: "index", base: result, index: literal(key.kind === "string" ? JSON.parse(key.text) : key.text) };
            }
            else if (accept("[")) {
                if (accept("]"))
                    result = { kind: "iterate", base: result };
                else {
                    const start = peek().text === ":" ? undefined : expression();
                    if (accept(":")) {
                        const end = peek().text === "]" ? undefined : expression();
                        expect("]");
                        result = { kind: "slice", base: result, start, end };
                    }
                    else {
                        expect("]");
                        result = { kind: "index", base: result, index: start };
                    }
                }
            }
            else
                break;
        }
        return result;
    };
    const ast = expression();
    if (peek().kind !== "end")
        syntaxError(peek(), true);
    const pending = [{ node: ast, depth: 1 }];
    const errors = [];
    let errorBytes = 0;
    while (pending.length) {
        const { node, depth } = pending.pop();
        if (depth > limits.maxAstDepth)
            throw new JqLimitError("maxAstDepth");
        const token = unresolved.get(node);
        if (token && node.kind === "call") {
            const message = diagnostic(token, `${node.name}/${node.args.length} is not defined`);
            errorBytes += Buffer.byteLength(message) + 5;
            if (errorBytes > limits.maxOutputBytes)
                throw new JqLimitError("maxOutputBytes");
            errors.push(message);
            continue;
        }
        const children = [];
        if (node.kind === "binary")
            children.push(node.left, node.right);
        else if (node.kind === "unary" || node.kind === "optional")
            children.push(node.operand);
        else if (node.kind === "index")
            children.push(node.base, node.index);
        else if (node.kind === "iterate")
            children.push(node.base);
        else if (node.kind === "slice") {
            children.push(node.base);
            if (node.start)
                children.push(node.start);
            if (node.end)
                children.push(node.end);
        }
        else if (node.kind === "array" && node.body)
            children.push(node.body);
        else if (node.kind === "object")
            for (const field of node.fields)
                children.push(field.key, field.value);
        else if (node.kind === "call")
            children.push(...node.args);
        else if (node.kind === "if")
            children.push(node.condition, node.yes, node.no);
        for (const child of children.reverse())
            pending.push({ node: child, depth: depth + 1 });
    }
    if (errors.length)
        throw new JqError(`${errors.join("\njq: ")}\njq: ${errors.length} compile error${errors.length === 1 ? "" : "s"}`, 3);
    return ast;
}
//# sourceMappingURL=parser.js.map