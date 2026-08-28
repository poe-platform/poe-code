export function parseRegex(source, flags = "") {
    const parsedFlags = parseFlags(flags);
    const parser = new RegexParser(source);
    const body = parser.parse();
    return {
        source,
        flags: parsedFlags,
        captureCount: parser.captureCount,
        body
    };
}
class RegexParser {
    source;
    captureCount = 0;
    position = 0;
    constructor(source) {
        this.source = source;
    }
    parse() {
        const body = this.parseAlternation();
        if (!this.atEnd()) {
            if (this.peek() === ")") {
                this.fail("Unmatched closing parenthesis");
            }
            this.fail(`Unexpected character '${this.peek()}'`);
        }
        return body;
    }
    parseAlternation() {
        const alternatives = [this.parseSequence()];
        while (this.peek() === "|") {
            this.position += 1;
            alternatives.push(this.parseSequence());
        }
        return alternatives.length === 1 ? alternatives[0] : { type: "alternation", alternatives };
    }
    parseSequence() {
        const elements = [];
        while (!this.atEnd() && this.peek() !== ")" && this.peek() !== "|") {
            elements.push(this.parseQuantifiedAtom());
        }
        if (elements.length === 0) {
            return { type: "empty" };
        }
        return elements.length === 1 ? elements[0] : { type: "sequence", elements };
    }
    parseQuantifiedAtom() {
        const quantifierStart = this.position;
        const current = this.peek();
        if (current === "*" || current === "+" || current === "?" || current === "{") {
            this.fail("Nothing to repeat", quantifierStart);
        }
        const body = this.parseAtom();
        const quantifier = this.parseQuantifier();
        if (quantifier === undefined) {
            return body;
        }
        if (body.type === "anchor" || body.type === "wordBoundary") {
            this.fail("Invalid quantifier target", quantifierStart);
        }
        const greedy = this.peek() !== "?";
        if (!greedy) {
            this.position += 1;
        }
        return { type: "quantifier", body, ...quantifier, greedy };
    }
    parseAtom() {
        const character = this.take();
        switch (character) {
            case ".":
                return { type: "dot" };
            case "^":
                return { type: "anchor", kind: "start" };
            case "$":
                return { type: "anchor", kind: "end" };
            case "(":
                return this.parseGroup(this.position - 1);
            case "[":
                return this.parseCharacterClass(this.position - 1);
            case "\\":
                return this.parseEscape(false, this.position - 1);
            default:
                return { type: "literal", value: character };
        }
    }
    parseGroup(start) {
        let capturing = true;
        if (this.peek() === "?") {
            const extension = this.source.slice(this.position, this.position + 3);
            if (extension.startsWith("?:")) {
                capturing = false;
                this.position += 2;
            }
            else if (extension.startsWith("?=") || extension.startsWith("?!")) {
                this.fail("Lookahead is not supported", start);
            }
            else if (extension.startsWith("?<=") || extension.startsWith("?<!")) {
                this.fail("Lookbehind is not supported", start);
            }
            else if (extension.startsWith("?<")) {
                this.fail("Named groups are not supported", start);
            }
            else {
                this.fail("Unsupported group construct", start);
            }
        }
        const index = capturing ? ++this.captureCount : undefined;
        const body = this.parseAlternation();
        if (this.peek() !== ")") {
            this.fail("Unterminated group", start);
        }
        this.position += 1;
        return { type: "group", capturing, index, body };
    }
    parseCharacterClass(start) {
        const negated = this.peek() === "^";
        if (negated) {
            this.position += 1;
        }
        const items = [];
        while (!this.atEnd()) {
            if (this.peek() === "]") {
                this.position += 1;
                return { type: "characterClass", negated, items };
            }
            const left = this.parseClassItem(start);
            if (this.peek() === "-" && this.source[this.position + 1] !== "]") {
                const rangePosition = this.position;
                this.position += 1;
                const right = this.parseClassItem(start);
                if (left.type !== "character" || right.type !== "character") {
                    this.fail("Character class ranges require literal endpoints", rangePosition);
                }
                if (left.value.charCodeAt(0) > right.value.charCodeAt(0)) {
                    this.fail("Character class range is out of order", rangePosition);
                }
                items.push({ type: "range", from: left.value, to: right.value });
            }
            else {
                items.push(left);
            }
        }
        this.fail("Unterminated character class", start);
    }
    parseClassItem(classStart) {
        if (this.atEnd()) {
            this.fail("Unterminated character class", classStart);
        }
        if (this.peek() === "\\") {
            const escapeStart = this.position;
            this.position += 1;
            const escaped = this.parseEscape(true, escapeStart);
            if (escaped.type === "literal") {
                return { type: "character", value: escaped.value };
            }
            if (escaped.type === "characterClass" && escaped.items.length === 1) {
                return escaped.items[0];
            }
            this.fail("Unsupported character class escape", escapeStart);
        }
        return { type: "character", value: this.take() };
    }
    parseEscape(inCharacterClass, start) {
        if (this.atEnd()) {
            this.fail("Trailing escape", start);
        }
        const escaped = this.take();
        if (escaped >= "1" && escaped <= "9") {
            this.fail("Backreferences are not supported", start);
        }
        if (escaped === "p" || escaped === "P") {
            this.fail("Unicode property escapes are not supported", start);
        }
        if (escaped === "x") {
            return { type: "literal", value: this.parseHexEscape(2, "hexadecimal", start) };
        }
        if (escaped === "u") {
            return { type: "literal", value: this.parseHexEscape(4, "Unicode", start) };
        }
        const kinds = {
            d: { kind: "digit", negated: false },
            D: { kind: "digit", negated: true },
            w: { kind: "word", negated: false },
            W: { kind: "word", negated: true },
            s: { kind: "space", negated: false },
            S: { kind: "space", negated: true }
        };
        const kind = kinds[escaped];
        if (kind !== undefined) {
            return { type: "characterClass", negated: false, items: [{ type: "kind", ...kind }] };
        }
        if (!inCharacterClass && (escaped === "b" || escaped === "B")) {
            return { type: "wordBoundary", negated: escaped === "B" };
        }
        const controls = {
            b: "\b",
            f: "\f",
            n: "\n",
            r: "\r",
            t: "\t",
            v: "\v",
            "0": "\0"
        };
        return { type: "literal", value: controls[escaped] ?? escaped };
    }
    parseHexEscape(length, name, start) {
        const end = this.position + length;
        const digits = this.source.slice(this.position, end);
        if (digits.length !== length || !allHexDigits(digits)) {
            this.fail(`Invalid ${name} escape`, start);
        }
        this.position = end;
        return String.fromCharCode(Number.parseInt(digits, 16));
    }
    parseQuantifier() {
        const character = this.peek();
        if (character === "*") {
            this.position += 1;
            return { min: 0 };
        }
        if (character === "+") {
            this.position += 1;
            return { min: 1 };
        }
        if (character === "?") {
            this.position += 1;
            return { min: 0, max: 1 };
        }
        if (character !== "{") {
            return undefined;
        }
        const start = this.position;
        this.position += 1;
        const min = this.parseDecimal();
        if (min === undefined) {
            this.position = start;
            return undefined;
        }
        if (this.peek() === "}") {
            this.position += 1;
            return { min, max: min };
        }
        if (this.peek() !== ",") {
            this.fail("Invalid quantifier", start);
        }
        this.position += 1;
        const max = this.parseDecimal();
        if (this.peek() !== "}") {
            this.fail("Unterminated quantifier", start);
        }
        this.position += 1;
        if (max !== undefined && min > max) {
            this.fail("Quantifier range is out of order", start);
        }
        return { min, max };
    }
    parseDecimal() {
        const start = this.position;
        while (isDecimalDigit(this.peek())) {
            this.position += 1;
        }
        if (start === this.position) {
            return undefined;
        }
        const value = Number(this.source.slice(start, this.position));
        if (!Number.isSafeInteger(value)) {
            this.fail("Quantifier is too large", start);
        }
        return value;
    }
    peek() {
        return this.source[this.position] ?? "";
    }
    take() {
        const character = this.peek();
        this.position += 1;
        return character;
    }
    atEnd() {
        return this.position >= this.source.length;
    }
    fail(message, position = this.position) {
        throw new SyntaxError(`${message} at position ${position}`);
    }
}
function parseFlags(flags) {
    const parsed = {
        global: false,
        ignoreCase: false,
        multiline: false,
        dotAll: false
    };
    const names = {
        g: "global",
        i: "ignoreCase",
        m: "multiline",
        s: "dotAll"
    };
    for (let position = 0; position < flags.length; position += 1) {
        const flag = flags[position];
        const name = names[flag];
        if (name === undefined) {
            throw new SyntaxError(`Unsupported regex flag '${flag}' at position ${position}`);
        }
        if (parsed[name]) {
            throw new SyntaxError(`Duplicate regex flag '${flag}' at position ${position}`);
        }
        parsed[name] = true;
    }
    return parsed;
}
function isDecimalDigit(character) {
    return character >= "0" && character <= "9";
}
function allHexDigits(value) {
    for (const character of value) {
        if (!isDecimalDigit(character) &&
            !(character >= "A" && character <= "F") &&
            !(character >= "a" && character <= "f")) {
            return false;
        }
    }
    return true;
}
