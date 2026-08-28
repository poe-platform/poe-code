import { ShellSyntaxError } from "./types.js";
import { arithmeticEnd, prepareArithmetic } from "./arithmetic.js";
export class HereDocumentSyntaxError extends Error {
    diagnostic;
    constructor(diagnostic) {
        super(diagnostic);
        this.diagnostic = diagnostic;
    }
}
function printedSimpleLines(lists, separators) {
    const printedLines = new Map();
    let line = 1;
    for (let index = 0; index < lists.length; index++) {
        for (const pipeline of lists[index].pipelines)
            for (const command of pipeline.commands) {
                if (command.kind !== "simple" || !command.words.length || command.redirects.some(redirect => redirect.document))
                    return {};
                const words = [...command.words, ...command.redirects.map(redirect => redirect.target)];
                if (words.some(word => word.printedNewlines === undefined))
                    return {};
                printedLines.set(command, line + command.words[0].printedNewlines);
                for (const word of words)
                    line += word.printedNewlines;
            }
        if (index < lists.length - 1 && separators[index])
            line++;
    }
    return { printedLines, printedNewlines: line - 1 };
}
class IncompleteShellInput extends Error {
}
class Lexer {
    source;
    depth;
    warnings;
    lineOffset;
    byteLocale;
    documentLine;
    partial;
    position = 0;
    printedNewlineReduction = 0;
    unprintedWords = 0;
    delimiterOperator;
    documents = [];
    constructor(source, depth, warnings = [], lineOffset = 0, byteLocale = false, documentLine, partial = false) {
        this.source = source;
        this.depth = depth;
        this.warnings = warnings;
        this.lineOffset = lineOffset;
        this.byteLocale = byteLocale;
        this.documentLine = documentLine;
        this.partial = partial;
        if (depth > 64)
            throw new ShellSyntaxError("Syntax nesting exceeds 64", 0);
    }
    lineAt(position) { return this.lineOffset + this.source.slice(0, position).split("\n").length; }
    error(message, unclosedQuote) {
        throw new ShellSyntaxError(message, this.position, 2, undefined, unclosedQuote);
    }
    next() {
        while (this.position < this.source.length) {
            const current = this.source[this.position];
            if (current === " " || current === "\t") {
                this.position++;
            }
            else if (current === "\\" && this.source[this.position + 1] === "\n") {
                this.position += 2;
            }
            else if (current === "#") {
                while (this.position < this.source.length && this.source[this.position] !== "\n")
                    this.position++;
            }
            else
                break;
        }
        const offset = this.position;
        if (offset === this.source.length) {
            if (this.partial)
                throw new IncompleteShellInput();
            this.readDocuments();
            return { kind: "end", value: "", offset, end: offset };
        }
        let logical = "";
        let cursor = offset;
        const ends = [];
        while (cursor < this.source.length && logical.length < 3) {
            if (this.source.startsWith("\\\n", cursor)) {
                cursor += 2;
                continue;
            }
            logical += this.source[cursor++];
            ends.push(cursor);
        }
        const operator = /^(?:;;&|<<<|<<-|;&|&&|\|\||>>|>&|<&|>\||<<|;;|&>|[;\n|&()<>])/u.exec(logical)?.[0];
        if (operator) {
            if (["&", "&>"].includes(operator))
                this.error(`Unsupported operator ${operator}`);
            this.position = ends[operator.length - 1];
            if (operator === "<<" || operator === "<<-")
                this.delimiterOperator = operator;
            if (operator === "\n")
                this.readDocuments();
            return { kind: "operator", value: operator, offset, end: this.position };
        }
        const delimiterOperator = this.delimiterOperator;
        this.delimiterOperator = undefined;
        const word = this.word(undefined, false, delimiterOperator !== undefined);
        if (this.position <= offset)
            this.error("Tokenizer made no progress");
        let document;
        if (delimiterOperator) {
            document = {
                delimiter: word.parts.map((part) => part.kind === "text" ? part.value : "").join(""),
                quoted: word.parts.some((part) => part.quoted), stripTabs: delimiterOperator === "<<-", offset,
                body: "", endLine: this.lineAt(offset), depth: this.depth,
            };
            this.documents.push(document);
        }
        return { kind: "word", value: word.plain ?? "", offset, end: this.position, word: { ...word, spelling: this.source.slice(offset, this.position) }, ...(document ? { document } : {}) };
    }
    readDocuments() {
        for (const document of this.documents.splice(0)) {
            let body = "";
            let terminated = false;
            while (this.position < this.source.length) {
                let line = "";
                while (this.position < this.source.length) {
                    const current = this.source[this.position++];
                    if (!document.quoted && current === "\\" && this.position < this.source.length) {
                        const next = this.source[this.position++];
                        if (next !== "\n")
                            line += current + next;
                    }
                    else if (current === "\n")
                        break;
                    else
                        line += current;
                }
                if (line === document.delimiter || (document.stripTabs && line.replace(/^\t+/u, "") === document.delimiter)) {
                    terminated = true;
                    break;
                }
                body += (document.stripTabs ? line.replace(/^\t+/u, "") : line) + "\n";
            }
            if (!terminated && this.partial)
                throw new IncompleteShellInput();
            if (!terminated)
                this.warnings.push(`here-document at offset ${document.offset} delimited by end-of-file (wanted ${JSON.stringify(document.delimiter)})`);
            document.body = body;
            document.endLine = this.lineAt(Math.max(0, this.position - 1));
        }
    }
    *documentWords() {
        let text = "";
        while (this.position < this.source.length) {
            const current = this.source[this.position];
            if (current === "$" || current === "`") {
                if (text) {
                    yield { offset: 0, parts: [{ kind: "text", value: text, quoted: true }] };
                    text = "";
                }
                const offset = this.position;
                const parts = [];
                try {
                    this.expansion(parts, true);
                }
                catch (error) {
                    if (!(error instanceof ShellSyntaxError) || /nesting|exceeds/u.test(error.reason))
                        throw error;
                    if (this.source.startsWith("${", offset))
                        throw new HereDocumentSyntaxError(`shell: line ${this.documentLine}: ${this.source}: bad substitution\n`);
                    if (current === "`")
                        throw new HereDocumentSyntaxError(`shell: line ${this.documentLine}: bad substitution: no closing "\`" in ${this.source.slice(offset)}\n`);
                    if (this.source.startsWith("$((", offset) && error.reason === "Unterminated arithmetic expression")
                        throw new HereDocumentSyntaxError(`shell: line ${this.documentLine}: bad substitution: no closing \`)' in ${this.source}\n`);
                    throw new HereDocumentSyntaxError(`shell: line ${this.documentLine}: ${error.message}\n`);
                }
                yield { offset, parts };
            }
            else if (current === "\\" && /[$`\\]/u.test(this.source[this.position + 1] ?? "")) {
                text += this.source[this.position + 1];
                this.position += 2;
            }
            else {
                text += current;
                this.position++;
            }
            if (text.length >= 1024) {
                yield { offset: 0, parts: [{ kind: "text", value: text, quoted: true }] };
                text = "";
            }
        }
        if (text)
            yield { offset: 0, parts: [{ kind: "text", value: text, quoted: true }] };
    }
    documentSubstitutionError(source, error, backtick = false) {
        const line = this.documentLine + source.slice(0, error.offset).split("\n").length;
        if (error.offset >= source.length) {
            return new HereDocumentSyntaxError(backtick
                ? `shell: command substitution: line ${line}: syntax error: unexpected end of file\n`
                : `shell: command substitution: line ${line}: unexpected EOF while looking for matching \`)'\n`);
        }
        const token = /^[;&|()<>]|^[^\s;&|()<>]+/u.exec(source.slice(error.offset))?.[0] ?? "newline";
        const sourceLine = source.split("\n")[source.slice(0, error.offset).split("\n").length - 1] ?? "";
        return new HereDocumentSyntaxError(`shell: command substitution: line ${line}: syntax error near unexpected token \`${token}'\nshell: command substitution: line ${line}: \`${sourceLine}'\n`);
    }
    literalExpansion() {
        const backtick = this.source[this.position] === "`";
        const opening = this.source[this.position + 1];
        if (!backtick && opening !== "(" && opening !== "{")
            return this.source[this.position++];
        let value = backtick ? "`" : `$${opening}`;
        this.position += backtick ? 1 : 2;
        const closers = [backtick ? "`" : opening === "(" ? ")" : "}"];
        let quote = "";
        while (this.position < this.source.length) {
            const current = this.source[this.position++];
            if (current === "\\" && quote !== "'") {
                const next = this.source[this.position++];
                if (next === undefined)
                    this.error("Trailing delimiter escape");
                if (next !== "\n")
                    value += quote === '"' && !/[$`"\\]/u.test(next) ? current + next : next;
            }
            else if (quote) {
                if (current === quote)
                    quote = "";
                else
                    value += current;
            }
            else if (current === "'" || current === '"')
                quote = current;
            else {
                value += current;
                if (current === closers.at(-1)) {
                    closers.pop();
                    if (!closers.length)
                        return value;
                }
                else if ((current === "(" && (closers.at(-1) === ")" || this.source[this.position - 2] === "$"))
                    || (current === "{" && (closers.at(-1) === "}" || this.source[this.position - 2] === "$"))) {
                    closers.push(current === "(" ? ")" : "}");
                    if (closers.length + this.depth > 64)
                        this.error("Syntax nesting exceeds 64");
                }
            }
        }
        this.error("Unterminated delimiter expansion syntax");
    }
    word(terminator, enclosingQuoted = false, literal = false, arithmetic = false) {
        const offset = this.position;
        const reduction = this.printedNewlineReduction;
        const unprinted = this.unprintedWords;
        const parts = [];
        let parentheses = 0;
        let conditionals = 0;
        let plain = true;
        const text = (value, quoted) => {
            const previous = parts.at(-1);
            if (previous?.kind === "text" && previous.quoted === quoted)
                previous.value += value;
            else
                parts.push({ kind: "text", value, quoted });
        };
        while (this.position < this.source.length) {
            const current = this.source[this.position];
            if (terminator ? terminator.includes(current) && (!arithmetic || current !== ":" || parentheses === 0 && conditionals === 0) : /[ \t\n;|&()<>]/u.test(current))
                break;
            if (current === "$" && this.source[this.position + 1] === "'" && !enclosingQuoted && !literal) {
                plain = false;
                this.unprintedWords++;
                text(this.ansiWord(), true);
            }
            else if (current === "'" && !enclosingQuoted) {
                plain = false;
                const end = this.source.indexOf("'", this.position + 1);
                if (end === -1)
                    this.error("Unterminated single quote", { quote: "'", line: this.lineAt(this.position) });
                text(this.source.slice(this.position + 1, end), true);
                this.position = end + 1;
            }
            else if (current === '"') {
                plain = false;
                const quoteLine = this.lineAt(this.position);
                this.position++;
                text("", true);
                while (this.position < this.source.length && this.source[this.position] !== '"') {
                    const inner = this.source[this.position];
                    if (!literal && (inner === "$" || inner === "`"))
                        this.expansion(parts, true);
                    else if (inner === "\\" && /[$`"\\\n]/u.test(this.source[this.position + 1] ?? "")) {
                        const escaped = this.source[this.position + 1];
                        if (escaped !== "\n")
                            text(escaped, true);
                        else
                            this.printedNewlineReduction++;
                        this.position += 2;
                    }
                    else {
                        text(inner, true);
                        this.position++;
                    }
                }
                if (this.source[this.position] !== '"')
                    this.error("Unterminated double quote", { quote: '"', line: quoteLine });
                this.position++;
            }
            else if (current === "\\") {
                if (this.source[this.position + 1] !== "\n")
                    plain = false;
                this.position++;
                if (this.position === this.source.length)
                    this.error("Trailing escape");
                if (this.source[this.position] !== "\n")
                    text(this.source[this.position], true);
                else
                    this.printedNewlineReduction++;
                this.position++;
            }
            else if (current === "$" || current === "`") {
                plain = false;
                if (literal) {
                    if (current === "$" && ["'", '"'].includes(this.source[this.position + 1] ?? ""))
                        this.error("Unsupported shell quoting in here-document delimiter");
                    text(this.literalExpansion(), current === "`");
                }
                else
                    this.expansion(parts, enclosingQuoted);
            }
            else {
                if (arithmetic) {
                    if (current === "(")
                        parentheses++;
                    else if (current === ")")
                        parentheses--;
                    else if (current === "?")
                        conditionals++;
                    else if (current === ":" && conditionals > 0)
                        conditionals--;
                }
                text(current, false);
                this.position++;
            }
        }
        const printedNewlines = this.source.slice(offset, this.position).split("\n").length - 1 - (this.printedNewlineReduction - reduction);
        return { parts, offset, ...(unprinted === this.unprintedWords ? { printedNewlines } : {}), ...(plain ? { plain: parts.map((part) => part.kind === "text" ? part.value : "").join("") } : {}) };
    }
    ansiWord() {
        const quoteLine = this.lineAt(this.position);
        this.position += 2;
        const bytes = [];
        const encoder = new TextEncoder();
        const escapes = { a: 7, b: 8, e: 27, E: 27, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, "'": 39, '"': 34, "?": 63 };
        while (this.position < this.source.length) {
            const character = String.fromCodePoint(this.source.codePointAt(this.position));
            this.position += character.length;
            if (character === "'") {
                const nul = bytes.indexOf(0);
                return new TextDecoder().decode(Uint8Array.from(nul < 0 ? bytes : bytes.slice(0, nul)));
            }
            if (character !== "\\") {
                bytes.push(...encoder.encode(character));
                continue;
            }
            const escape = this.source[this.position++];
            if (escape === undefined)
                this.error("Unterminated ANSI-C quote", { quote: "'", line: quoteLine });
            if (escapes[escape] !== undefined) {
                bytes.push(escapes[escape]);
                continue;
            }
            if (/[0-7]/u.test(escape)) {
                const digits = escape + (/^[0-7]{0,2}/u.exec(this.source.slice(this.position))?.[0] ?? "");
                this.position += digits.length - 1;
                bytes.push(parseInt(digits, 8) & 255);
            }
            else if (["x", "u", "U"].includes(escape)) {
                const maximum = escape === "x" ? 2 : escape === "u" ? 4 : 8;
                const digits = new RegExp(`^[0-9a-fA-F]{1,${maximum}}`, "u").exec(this.source.slice(this.position))?.[0];
                if (!digits) {
                    bytes.push(92, escape.charCodeAt(0));
                    continue;
                }
                this.position += digits.length;
                const code = parseInt(digits, 16);
                if (escape === "x")
                    bytes.push(code);
                else if (this.byteLocale && code > 127) {
                    bytes.push(...encoder.encode(`\\${code <= 0xffff ? "u" : "U"}${code.toString(16).toUpperCase().padStart(code <= 0xffff ? 4 : 8, "0")}`));
                }
                else {
                    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
                        this.error("Unsupported non-scalar ANSI-C Unicode escape");
                    bytes.push(...encoder.encode(String.fromCodePoint(code)));
                }
            }
            else if (escape === "c" && this.source[this.position] !== "'" && this.position < this.source.length) {
                const control = this.source[this.position++];
                if (control === "\\" && this.source[this.position] === "\\")
                    this.position++;
                bytes.push(control === "?" ? 127 : control.toUpperCase().charCodeAt(0) & 31);
            }
            else
                bytes.push(92, ...encoder.encode(escape));
        }
        this.error("Unterminated ANSI-C quote", { quote: "'", line: quoteLine });
    }
    expansion(parts, quoted) {
        const line = this.documentLine ?? this.lineAt(this.position);
        if (this.source[this.position] === "`") {
            this.position++;
            let source = "";
            while (this.position < this.source.length && this.source[this.position] !== "`") {
                if (this.source[this.position] === "\\" && /[$`\\]/u.test(this.source[this.position + 1] ?? ""))
                    this.position++;
                source += this.source[this.position++];
            }
            if (this.source[this.position] !== "`")
                this.error("Unterminated command substitution");
            this.position++;
            try {
                parts.push({ kind: "substitution", script: parseSource(source, this.depth + 1, this.warnings, line - 1, this.byteLocale), line, quoted });
            }
            catch (error) {
                if (this.documentLine === undefined || !(error instanceof ShellSyntaxError) || /nesting|exceeds/u.test(error.reason))
                    throw error;
                parts.push({ kind: "failed-substitution", diagnostic: this.documentSubstitutionError(source, error, true).diagnostic, quoted });
            }
            return;
        }
        this.position++;
        if (["$", "!"].includes(this.source[this.position] ?? "") || (!quoted && ["'", '"'].includes(this.source[this.position] ?? "")))
            this.error("Unsupported shell quoting or special parameter");
        if (this.source.startsWith("((", this.position)) {
            const start = this.position + 2;
            const end = arithmeticEnd(this.source, start);
            const source = this.source.slice(start, end);
            parts.push({ kind: "arithmetic", expression: prepareArithmetic(source), source, line, quoted });
            this.position = end + 2;
        }
        else if (this.source[this.position] === "(") {
            const start = this.position + 1;
            let nested;
            let script;
            try {
                nested = new Parser(this.source.slice(start), this.depth + 1, this.warnings, this.lineAt(start) - 1, undefined, this.byteLocale);
                script = nested.script(new Set([")"]));
            }
            catch (error) {
                if (this.documentLine !== undefined && error instanceof ShellSyntaxError && !/nesting|exceeds/u.test(error.reason))
                    throw this.documentSubstitutionError(this.source.slice(start), error);
                if (error instanceof ShellSyntaxError && !/Unterminated|nesting|exceeds/u.test(error.reason))
                    throw new ShellSyntaxError(error.reason, start + error.offset, 127);
                throw error;
            }
            if (nested.current.value !== ")") {
                if (this.documentLine !== undefined)
                    throw this.documentSubstitutionError(this.source.slice(start), new ShellSyntaxError("Unterminated command substitution", nested.current.offset));
                this.error("Unterminated command substitution");
            }
            if (nested.lexer.documents.length)
                this.error("Here-document requires a newline before closing command substitution");
            this.position += nested.current.end + 1;
            if (script.printedNewlines === undefined)
                this.unprintedWords++;
            else
                this.printedNewlineReduction += this.source.slice(start, this.position - 1).split("\n").length - 1 - script.printedNewlines;
            parts.push({ kind: "substitution", script, line, sourceLine: script.line ?? line, quoted });
        }
        else if (this.source[this.position] === "{") {
            this.position++;
            const parameterStart = this.position - 2;
            const length = this.source[this.position] === "#" && /[a-zA-Z_]/u.test(this.source[this.position + 1] ?? "");
            if (length)
                this.position++;
            const name = /^(?:[a-zA-Z_][a-zA-Z_0-9]*|[0-9]+|[?@*#-])/u.exec(this.source.slice(this.position))?.[0];
            if (!name)
                this.error("Unsupported parameter expansion");
            this.position += name.length;
            const operator = /^(?::[-=+?]|##|%%|\/\/|\/[#%]?|[-=+?#%])/u.exec(this.source.slice(this.position))?.[0];
            let alternate;
            let replacement;
            let substring;
            if (operator) {
                if (length)
                    this.error("Invalid length expansion");
                this.position += operator.length;
                alternate = this.word(operator.startsWith("/") ? "/}" : "}", quoted && !["#", "##", "%", "%%"].includes(operator) && !operator.startsWith("/"));
                if (operator.startsWith("/") && this.source[this.position] === "/") {
                    this.position++;
                    replacement = this.word("}");
                }
            }
            else if (this.source[this.position] === ":") {
                if (length || !/^(?:[a-zA-Z_][a-zA-Z_0-9]*|[0-9]+)$/u.test(name))
                    this.error("Unsupported non-scalar substring expansion");
                this.position++;
                const offset = this.word(":}", true, false, true);
                let substringLength;
                if (this.source[this.position] === ":") {
                    this.position++;
                    substringLength = this.word("}", true, false, true);
                }
                substring = { offset, ...(substringLength ? { length: substringLength } : {}), source: this.source.slice(parameterStart, this.position + 1) };
            }
            if (this.source[this.position] !== "}")
                this.error("Unterminated or unsupported parameter expansion");
            this.position++;
            parts.push({ kind: "variable", name, quoted, line, ...(length ? { length } : {}), ...(operator ? { operator, alternate: alternate } : {}), ...(replacement ? { replacement } : {}), ...(substring ? { substring } : {}) });
        }
        else {
            const name = /^(?:[a-zA-Z_][a-zA-Z_0-9]*|[?@*#0-9-])/u.exec(this.source.slice(this.position))?.[0];
            if (name) {
                this.position += name.length;
                parts.push({ kind: "variable", name, quoted });
            }
            else
                parts.push({ kind: "text", value: "$", quoted });
        }
    }
}
class Parser {
    lexer;
    current;
    lookahead;
    nesting = 0;
    openCommands = [];
    constructor(source, depth, warnings = [], lineOffset = 0, position, byteLocale = false, partial = false) {
        if (position === undefined && depth === 0 && source.includes("\0"))
            throw new ShellSyntaxError("NUL bytes are not valid shell source", source.indexOf("\0"));
        this.lexer = new Lexer(source, depth, warnings, lineOffset, byteLocale, undefined, partial);
        this.lexer.position = position ?? 0;
        this.current = this.lexer.next();
    }
    error(message) {
        const command = this.current.kind === "end" ? this.openCommands.findLast((command) => ["{", "if", "while", "until", "for", "case"].includes(command.name)) : undefined;
        throw new ShellSyntaxError(message, this.current.offset, 2, command);
    }
    advance() {
        const previous = this.current;
        this.current = this.lookahead ?? this.lexer.next();
        this.lookahead = undefined;
        return previous;
    }
    peek() {
        return this.lookahead ??= this.lexer.next();
    }
    is(value) { return this.current.value === value; }
    isEnd() { return this.current.kind === "end"; }
    expect(value) {
        if (!this.is(value))
            this.error(`Expected ${value}`);
        this.advance();
    }
    newlines() { while (this.is("\n"))
        this.advance(); }
    script(stops = new Set(), inputUnit = false) {
        const lists = [];
        const separators = [];
        this.newlines();
        const line = this.lexer.lineAt(this.current.offset);
        while (this.current.kind !== "end" && !stops.has(this.current.value)) {
            const pipelines = [this.pipeline()];
            const operators = [];
            while (this.is("&&") || this.is("||")) {
                operators.push(this.advance().value);
                this.newlines();
                pipelines.push(this.pipeline());
            }
            lists.push({ pipelines, operators });
            separators.push(this.is("\n"));
            if (inputUnit && this.is("\n"))
                break;
            if (this.is(";") || this.is("\n")) {
                this.advance();
                if (inputUnit && this.is("\n"))
                    break;
                this.newlines();
            }
            else if (!this.isEnd() && !this.is(")") && !(stops.has(this.current.value) && [";;", ";&", ";;&"].includes(this.current.value)))
                this.error("Expected command separator");
        }
        const printed = printedSimpleLines(lists, separators);
        return { lists, line, ...printed };
    }
    pipeline() {
        const negate = this.is("!");
        if (negate)
            this.advance();
        const commands = [this.command()];
        while (this.is("|")) {
            this.advance();
            this.newlines();
            commands.push(this.command());
        }
        return { commands, negate };
    }
    command() {
        if (++this.nesting + this.lexer.depth > 64)
            this.error("Syntax nesting exceeds 64");
        const line = this.lexer.lineAt(this.current.offset);
        this.openCommands.push({ name: this.current.value, line });
        try {
            const command = this.commandInner();
            return { ...command, line: command.line ?? line };
        }
        finally {
            this.nesting--;
            this.openCommands.pop();
        }
    }
    commandInner() {
        let command;
        if (this.is("(") && this.lexer.source.startsWith("((", this.current.offset)) {
            const start = this.current.offset + 2;
            const end = arithmeticEnd(this.lexer.source, start);
            const source = this.lexer.source.slice(start, end);
            command = { kind: "arithmetic", expression: prepareArithmetic(source), source, redirects: [] };
            this.lexer.position = end + 2;
            this.lookahead = undefined;
            this.current = this.lexer.next();
        }
        else if (this.is("(") || this.is("{")) {
            const subshell = this.is("(");
            this.advance();
            const body = this.script(new Set([subshell ? ")" : "}"]));
            if (!body.lists.length)
                this.error("Empty compound command");
            this.expect(subshell ? ")" : "}");
            command = { kind: subshell ? "subshell" : "group", body, redirects: [] };
        }
        else if (this.is("if")) {
            this.advance();
            const branches = [];
            while (true) {
                const condition = this.nonemptyScript(new Set(["then"]));
                this.expect("then");
                const body = this.nonemptyScript(new Set(["elif", "else", "fi"]));
                branches.push({ condition, body });
                if (!this.is("elif"))
                    break;
                this.advance();
            }
            let otherwise;
            if (this.is("else")) {
                this.advance();
                otherwise = this.nonemptyScript(new Set(["fi"]));
            }
            this.expect("fi");
            command = { kind: "if", branches, ...(otherwise ? { otherwise } : {}), redirects: [] };
        }
        else if (this.is("case")) {
            this.advance();
            if (!this.current.word)
                this.error("Expected case subject");
            const subject = this.advance().word;
            this.newlines();
            this.expect("in");
            this.newlines();
            const clauses = [];
            while (!this.is("esac")) {
                if (this.is("("))
                    this.advance();
                const patterns = [];
                while (true) {
                    if (!this.current.word)
                        this.error("Expected case pattern");
                    patterns.push(this.advance().word);
                    if (!this.is("|"))
                        break;
                    this.advance();
                }
                this.expect(")");
                const body = this.script(new Set([";;", ";&", ";;&", "esac"]));
                if (![";;", ";&", ";;&", "esac"].includes(this.current.value))
                    this.error("Expected case terminator");
                const terminator = this.current.value;
                clauses.push({ patterns, body, terminator });
                if (terminator === "esac")
                    break;
                this.advance();
                this.newlines();
            }
            this.expect("esac");
            command = { kind: "case", subject, clauses, redirects: [] };
        }
        else if (this.is("while") || this.is("until")) {
            const kind = this.advance().value;
            const condition = this.nonemptyScript(new Set(["do"]));
            this.expect("do");
            const body = this.nonemptyScript(new Set(["done"]));
            this.expect("done");
            command = { kind, condition, body, redirects: [] };
        }
        else if (this.is("for")) {
            this.advance();
            const name = this.advance().value;
            if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name))
                this.error("Invalid for variable");
            this.newlines();
            let words;
            if (this.is("in")) {
                this.advance();
                words = [];
                while (this.current.kind === "word")
                    words.push(this.advance().word);
            }
            if (this.is(";") || this.is("\n"))
                this.advance();
            else if (words)
                this.error("Expected for separator");
            this.newlines();
            this.expect("do");
            const body = this.nonemptyScript(new Set(["done"]));
            this.expect("done");
            command = { kind: "for", name, ...(words ? { words } : {}), body, redirects: [] };
        }
        else if (this.current.kind === "word" && this.peek().value === "(") {
            const name = this.advance().value;
            if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name))
                this.error("Invalid function name");
            this.expect("(");
            this.expect(")");
            this.newlines();
            if (!["{", "(", "if", "case", "while", "until", "for"].includes(this.current.value))
                this.error("Expected function body");
            command = { kind: "function", name, body: this.command(), redirects: [] };
        }
        else {
            if (["!", "then", "else", "elif", "fi", "do", "done", "}", "case", "esac", "select", "function", "[[", "]]"].includes(this.current.value))
                this.error(`Unexpected or unsupported keyword ${this.current.value}`);
            const words = [];
            const redirects = [];
            let line;
            while (true) {
                const wordLine = this.lexer.lineAt(Math.max(this.current.offset, this.current.end - 1));
                const redirect = this.redirect();
                if (redirect) {
                    line ??= redirect.line;
                    redirects.push(redirect);
                }
                else if (this.current.kind === "word") {
                    line ??= wordLine;
                    words.push(this.advance().word);
                }
                else
                    break;
            }
            if (!words.length && !redirects.length)
                this.error("Expected command");
            return { kind: "simple", words, redirects, ...(line === undefined ? {} : { line }) };
        }
        let redirect;
        while ((redirect = this.redirect()))
            command.redirects.push(redirect);
        return command;
    }
    nonemptyScript(stops) {
        const script = this.script(stops);
        if (!script.lists.length)
            this.error("Expected nonempty compound list");
        return script;
    }
    redirect() {
        let descriptor;
        if (this.current.kind === "word" && /^\d+$/u.test(this.current.value)) {
            const next = this.peek();
            if (/^(?:>|>>|<|<<|<<-|<<<|>&|<&|>\|)$/u.test(next.value) && this.current.end === next.offset)
                descriptor = Number(this.advance().value);
        }
        if (!/^(?:>|>>|<|<<|<<-|<<<|>&|<&|>\|)$/u.test(this.current.value) || this.current.kind !== "operator")
            return undefined;
        const operator = this.advance().value;
        descriptor ??= operator.startsWith("<") ? 0 : 1;
        if (!Number.isSafeInteger(descriptor) || descriptor > 255)
            this.error("File descriptor must be between 0 and 255");
        if (!this.current.word)
            this.error("Expected redirect target");
        const target = this.advance();
        return { descriptor, operator, target: target.word, line: this.lexer.lineAt(Math.max(target.offset, target.end - 1)), ...((operator === "<&" || operator === ">&") && this.lexer.source[target.end - 1] === "-" ? { move: true } : {}), ...(target.document ? { document: target.document } : {}) };
    }
}
export function parseShell(source, depth = 0) {
    const warnings = [];
    const script = parseSource(source, depth, warnings);
    return { ...script, ...(warnings.length ? { warnings } : {}) };
}
export function* hereDocumentWords(document, line, byteLocale, warnings) {
    if (document.quoted)
        yield { offset: document.offset, parts: [{ kind: "text", value: document.body, quoted: true }] };
    else
        yield* new Lexer(document.body, document.depth, warnings, line - 1, byteLocale, line).documentWords();
}
export function parseShellUnit(source, position = 0, byteLocale = false) {
    const warnings = [];
    const parser = new Parser(source, 0, warnings, 0, position, byteLocale);
    const script = parser.script(new Set(), true);
    const next = parser.current.end;
    const nul = source.indexOf("\0", position);
    if (nul >= 0 && nul < next)
        throw new ShellSyntaxError("NUL bytes are not valid shell source", nul);
    return { script: { ...script, ...(warnings.length ? { warnings } : {}) }, next };
}
export function parseShellInputUnit(source, byteLocale = false) {
    const warnings = [];
    try {
        const parser = new Parser(source, 0, warnings, 0, 0, byteLocale, true);
        const script = parser.script(new Set(), true);
        return { script: { ...script, ...(warnings.length ? { warnings } : {}) }, next: parser.current.end };
    }
    catch (error) {
        if (error instanceof IncompleteShellInput)
            return undefined;
        if (error instanceof ShellSyntaxError && (/^Unterminated|^Trailing escape/u.test(error.reason) || (error.offset >= source.length && !/Unsupported|unsupported|nesting|exceeds/u.test(error.reason))))
            return undefined;
        throw error;
    }
}
function parseSource(source, depth, warnings, lineOffset = 0, byteLocale = false) {
    const parser = new Parser(source, depth, warnings, lineOffset, undefined, byteLocale);
    const script = parser.script();
    if (parser.current.kind !== "end")
        parser.error("Unexpected token");
    return script;
}
//# sourceMappingURL=parser.js.map