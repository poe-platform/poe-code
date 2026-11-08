export function AS001(source, options = {}) {
    return new AS001Scanner(source, options.filename ?? "<input>").scan();
}
const KEYWORDS = new Set([
    "async",
    "await",
    "break",
    "catch",
    "class",
    "const",
    "continue",
    "do",
    "else",
    "false",
    "finally",
    "for",
    "from",
    "if",
    "import",
    "in",
    "let",
    "new",
    "null",
    "of",
    "return",
    "switch",
    "throw",
    "this",
    "true",
    "try",
    "undefined",
    "var",
    "while",
    "with"
]);
const EXPRESSION_ENDING_KEYWORDS = new Set(["false", "null", "this", "true", "undefined"]);
const CONTROL_FLOW_PAREN_KEYWORDS = new Set(["catch", "for", "if", "switch", "while", "with"]);
const PUNCTUATORS = [
    ">>>=",
    "&&=",
    "||=",
    "??=",
    "===",
    "!==",
    ">>>",
    "<<=",
    ">>=",
    "**=",
    "?.",
    "...",
    "??",
    "&&",
    "||",
    "==",
    "!=",
    "<=",
    ">=",
    "=>",
    "++",
    "--",
    "<<",
    ">>",
    "**",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "&=",
    "|=",
    "^=",
    "{",
    "}",
    "(",
    ")",
    "[",
    "]",
    ".",
    ";",
    ",",
    ":",
    "?",
    "~",
    "+",
    "-",
    "*",
    "/",
    "%",
    "&",
    "|",
    "^",
    "!",
    "<",
    ">",
    "="
];
class AS001Scanner {
    source;
    filename;
    index = 0;
    line = 1;
    column = 1;
    diagnostics = [];
    constructor(source, filename) {
        this.source = source;
        this.filename = filename;
    }
    scan() {
        this.scanCode();
        return this.diagnostics;
    }
    scanCode(stopAtTemplateExpressionEnd = false) {
        let previousToken;
        let previousPreviousToken;
        const groupingStack = [];
        const braceContextStack = [];
        let lastClosedControlParenthesis = false;
        let canStartStatement = true;
        let templateExpressionBraceDepth = 0;
        let pendingClassBody = false;
        while (!this.isAtEnd()) {
            this.skipTrivia();
            if (this.isAtEnd()) {
                return;
            }
            const start = this.position();
            const char = this.currentChar();
            if (stopAtTemplateExpressionEnd && char === "}" && templateExpressionBraceDepth === 0) {
                this.advance();
                return;
            }
            let token;
            if (isIdentifierStart(char)) {
                token = this.readIdentifierOrKeyword(start);
            }
            else if (char === "'" || char === '"') {
                token = this.readString(start, char);
            }
            else if (char === "`") {
                token = this.readTemplate(start);
            }
            else if (isDecimalDigit(char) || (char === "." && isDecimalDigit(this.peekChar(1)))) {
                token = this.readNumber(start);
            }
            else if (char === "/" &&
                this.peekChar(1) !== "=" &&
                shouldRejectRegexLiteral(previousToken, lastClosedControlParenthesis)) {
                token = this.readRegexLiteral(start);
            }
            else {
                token = this.readPunctuator(start);
            }
            if (token.type === "identifier" || token.type === "keyword") {
                const nextSignificantChar = this.peekNextSignificantChar();
                const isMemberProperty = previousToken?.type === "punctuator" &&
                    (previousToken.value === "." || previousToken.value === "?.");
                const isPropertyKey = nextSignificantChar === ":" && !canStartStatement;
                const isMemberName = isMemberNameToken(token, previousToken, previousPreviousToken, braceContextStack, nextSignificantChar);
                if (canStartStatement && nextSignificantChar === ":" && !this.isLoopLabelStart()) {
                    this.report("label", token.start, this.positionWithinSource(token.start.offset + token.value.length));
                }
                else if (!isMemberProperty && !isPropertyKey && !isMemberName) {
                    this.reportForbiddenIdentifier(token);
                    if (token.value === "class") {
                        pendingClassBody = true;
                    }
                }
            }
            const isStatementBrace = token.type === "punctuator" && token.value === "{" && canStartStatement;
            if (token.type === "punctuator" && token.value === "{") {
                braceContextStack.push({
                    kind: pendingClassBody && !canStartStatement
                        ? "class"
                        : isStatementBrace
                            ? "statement"
                            : "object"
                });
                pendingClassBody = false;
                if (stopAtTemplateExpressionEnd) {
                    templateExpressionBraceDepth += 1;
                }
            }
            else if (token.type === "punctuator" && token.value === "}") {
                const closedBraceContext = braceContextStack.pop();
                const closedStatementBrace = closedBraceContext?.kind === "statement";
                if (stopAtTemplateExpressionEnd) {
                    templateExpressionBraceDepth -= 1;
                }
                lastClosedControlParenthesis =
                    token.type === "punctuator"
                        ? updateGroupingState(groupingStack, previousToken, token.value)
                        : false;
                canStartStatement = updateStatementStart(token, lastClosedControlParenthesis, false, closedStatementBrace);
                previousPreviousToken = previousToken;
                previousToken = token;
                continue;
            }
            if (token.type === "punctuator" &&
                token.value === "*" &&
                isGeneratorMemberToken(previousToken, previousPreviousToken, braceContextStack)) {
                this.report("generator", token.start, token.end);
            }
            lastClosedControlParenthesis =
                token.type === "punctuator"
                    ? updateGroupingState(groupingStack, previousToken, token.value)
                    : false;
            canStartStatement = updateStatementStart(token, lastClosedControlParenthesis, isStatementBrace, false);
            previousPreviousToken = previousToken;
            previousToken = token;
        }
    }
    reportForbiddenIdentifier(token) {
        switch (token.value) {
            case "class":
            case "eval":
            case "Function":
            case "switch":
            case "this":
            case "var":
            case "with":
                this.report(token.value, token.start, token.end);
                return;
            case "new":
                if (!this.source.slice(this.skipTriviaFrom(token.end.offset)).startsWith("RegExp")) {
                    this.report(token.value, token.start, token.end);
                }
                return;
            default:
                return;
        }
    }
    report(construct, start, end) {
        this.diagnostics.push({
            code: "AS001",
            severity: "error",
            message: `Disallowed syntax: ${construct}.`,
            filename: this.filename,
            line: start.line,
            column: start.column,
            span: createSpan(start, end)
        });
    }
    skipTrivia() {
        while (!this.isAtEnd()) {
            const char = this.currentChar();
            if (isWhitespace(char) || isLineBreak(char)) {
                this.advance();
                continue;
            }
            if (char === "/" && this.peekChar(1) === "/") {
                this.advance();
                this.advance();
                while (!this.isAtEnd() && !isLineBreak(this.currentChar())) {
                    this.advance();
                }
                continue;
            }
            if (char === "/" && this.peekChar(1) === "*") {
                this.advance();
                this.advance();
                while (!this.isAtEnd()) {
                    if (this.currentChar() === "*" && this.peekChar(1) === "/") {
                        this.advance();
                        this.advance();
                        break;
                    }
                    this.advance();
                }
                continue;
            }
            return;
        }
    }
    readIdentifierOrKeyword(start) {
        this.advance();
        while (!this.isAtEnd() && isIdentifierPart(this.currentChar())) {
            this.advance();
        }
        const value = this.source.slice(start.offset, this.index);
        return {
            type: KEYWORDS.has(value) ? "keyword" : "identifier",
            value,
            start,
            end: this.position()
        };
    }
    readString(start, quote) {
        this.advance();
        while (!this.isAtEnd()) {
            const char = this.currentChar();
            if (char === quote) {
                this.advance();
                break;
            }
            if (char === "\\") {
                this.advance();
                if (!this.isAtEnd()) {
                    this.advance();
                }
                continue;
            }
            this.advance();
        }
        return {
            type: "string",
            value: this.source.slice(start.offset, this.index),
            start,
            end: this.position()
        };
    }
    readTemplate(start) {
        this.advance();
        while (!this.isAtEnd()) {
            const char = this.currentChar();
            if (char === "`") {
                this.advance();
                break;
            }
            if (char === "\\") {
                this.advance();
                if (!this.isAtEnd()) {
                    this.advance();
                }
                continue;
            }
            if (char === "$" && this.peekChar(1) === "{") {
                this.advance();
                this.advance();
                this.scanCode(true);
                continue;
            }
            this.advance();
        }
        return {
            type: "template",
            value: "`",
            start,
            end: this.position()
        };
    }
    readNumber(start) {
        if (this.currentChar() === ".") {
            this.advance();
            while (!this.isAtEnd() && isDecimalDigit(this.currentChar())) {
                this.advance();
            }
        }
        else {
            this.advance();
            while (!this.isAtEnd() && isIdentifierPart(this.currentChar())) {
                this.advance();
            }
            while (!this.isAtEnd() && this.currentChar() === ".") {
                this.advance();
                while (!this.isAtEnd() && isIdentifierPart(this.currentChar())) {
                    this.advance();
                }
            }
        }
        return {
            type: "numeric",
            value: this.source.slice(start.offset, this.index),
            start,
            end: this.position()
        };
    }
    readRegexLiteral(start) {
        this.advance();
        let inCharacterClass = false;
        while (!this.isAtEnd()) {
            const char = this.currentChar();
            if (char === "\\") {
                this.advance();
                if (!this.isAtEnd()) {
                    this.advance();
                }
                continue;
            }
            if (char === "[" && !inCharacterClass) {
                inCharacterClass = true;
                this.advance();
                continue;
            }
            if (char === "]" && inCharacterClass) {
                inCharacterClass = false;
                this.advance();
                continue;
            }
            if (char === "/" && !inCharacterClass) {
                this.advance();
                while (!this.isAtEnd() && isAsciiLetter(this.currentChar())) {
                    this.advance();
                }
                break;
            }
            this.advance();
        }
        return {
            type: "regex",
            value: this.source.slice(start.offset, this.index),
            start,
            end: this.position()
        };
    }
    readPunctuator(start) {
        const punctuator = matchPunctuator(this.source, this.index);
        if (punctuator === undefined) {
            this.advance();
            return {
                type: "punctuator",
                value: this.source.slice(start.offset, this.index),
                start,
                end: this.position()
            };
        }
        this.advanceBy(punctuator.length);
        return {
            type: "punctuator",
            value: punctuator,
            start,
            end: this.position()
        };
    }
    peekNextSignificantChar() {
        const nextIndex = this.skipTriviaFrom(this.index);
        return nextIndex >= this.source.length ? undefined : this.source[nextIndex];
    }
    isLoopLabelStart() {
        let index = this.skipTriviaFrom(this.index);
        if (this.source[index] !== ":") {
            return false;
        }
        index = this.skipTriviaFrom(index + 1);
        while (index < this.source.length) {
            const identifier = readIdentifierAt(this.source, index);
            if (identifier === undefined) {
                return false;
            }
            if (identifier.value === "for" || identifier.value === "while" || identifier.value === "do") {
                return true;
            }
            const nextIndex = this.skipTriviaFrom(identifier.end);
            if (this.source[nextIndex] !== ":") {
                return false;
            }
            index = this.skipTriviaFrom(nextIndex + 1);
        }
        return false;
    }
    skipTriviaFrom(start) {
        let index = start;
        while (index < this.source.length) {
            const char = this.source[index];
            if (isWhitespace(char) || isLineBreak(char)) {
                index += 1;
                continue;
            }
            if (char === "/" && this.source[index + 1] === "/") {
                index += 2;
                while (index < this.source.length && !isLineBreak(this.source[index])) {
                    index += 1;
                }
                continue;
            }
            if (char === "/" && this.source[index + 1] === "*") {
                index += 2;
                while (index < this.source.length) {
                    if (this.source[index] === "*" && this.source[index + 1] === "/") {
                        index += 2;
                        break;
                    }
                    index += 1;
                }
                continue;
            }
            break;
        }
        return index;
    }
    currentChar() {
        return this.source[this.index] ?? "";
    }
    peekChar(offset) {
        return this.source[this.index + offset] ?? "";
    }
    advance() {
        const char = this.source[this.index];
        this.index += 1;
        if (isLineBreak(char)) {
            if (char !== "\n" || this.source[this.index - 2] !== "\r")
                this.line += 1;
            this.column = 1;
            return;
        }
        this.column += 1;
    }
    advanceBy(length) {
        for (let index = 0; index < length; index += 1) {
            this.advance();
        }
    }
    isAtEnd() {
        return this.index >= this.source.length;
    }
    position() {
        return {
            line: this.line,
            column: this.column,
            offset: this.index
        };
    }
    positionWithinSource(offset) {
        let line = 1;
        let column = 1;
        for (let index = 0; index < offset; index += 1) {
            if (isLineBreak(this.source[index])) {
                if (this.source[index] !== "\n" || this.source[index - 1] !== "\r")
                    line += 1;
                column = 1;
                continue;
            }
            column += 1;
        }
        return {
            line,
            column,
            offset
        };
    }
}
function createSpan(start, end) {
    return {
        start: { ...start },
        end: { ...end }
    };
}
function isMemberNameToken(token, previousToken, previousPreviousToken, braceContextStack, nextSignificantChar) {
    const memberContext = braceContextStack.at(-1);
    if (memberContext === undefined) {
        return false;
    }
    if (memberContext.kind !== "class" && memberContext.kind !== "object") {
        return false;
    }
    if (nextSignificantChar !== "(") {
        return false;
    }
    if (isMemberEntryStart(previousToken, memberContext.kind)) {
        return true;
    }
    if (isMemberModifierToken(previousToken)) {
        return isMemberEntryStart(previousPreviousToken, memberContext.kind);
    }
    return previousToken?.type === "punctuator" && previousToken.value === "*";
}
function isGeneratorMemberToken(previousToken, previousPreviousToken, braceContextStack) {
    const memberContext = braceContextStack.at(-1);
    if (memberContext === undefined) {
        return false;
    }
    if (memberContext.kind !== "class" && memberContext.kind !== "object") {
        return false;
    }
    if (isMemberEntryStart(previousToken, memberContext.kind)) {
        return true;
    }
    return (isMemberModifierToken(previousToken) &&
        isMemberEntryStart(previousPreviousToken, memberContext.kind));
}
function isMemberEntryStart(token, kind) {
    if (token?.type !== "punctuator") {
        return false;
    }
    if (token.value === "{") {
        return true;
    }
    if (token.value === ",") {
        return kind === "object";
    }
    if (token.value === ";" || token.value === "}") {
        return kind === "class";
    }
    return false;
}
function isMemberModifierToken(token) {
    if (token === undefined) {
        return false;
    }
    if (token.type !== "identifier" && token.type !== "keyword") {
        return false;
    }
    return (token.value === "async" ||
        token.value === "get" ||
        token.value === "set" ||
        token.value === "static");
}
function updateStatementStart(token, lastClosedControlParenthesis, isStatementBrace, closedStatementBrace) {
    if (token.type === "punctuator") {
        if (token.value === ")" && lastClosedControlParenthesis) {
            return true;
        }
        if (token.value === "{") {
            return isStatementBrace;
        }
        if (token.value === "}") {
            return closedStatementBrace;
        }
        return token.value === ";";
    }
    if (token.type === "keyword") {
        return token.value === "do" || token.value === "else";
    }
    return false;
}
function matchPunctuator(source, index) {
    return PUNCTUATORS.find((punctuator) => source.startsWith(punctuator, index));
}
function shouldRejectRegexLiteral(previousToken, lastClosedControlParenthesis) {
    if (previousToken === undefined) {
        return true;
    }
    if (previousToken.type === "identifier" ||
        previousToken.type === "numeric" ||
        previousToken.type === "regex" ||
        previousToken.type === "string" ||
        previousToken.type === "template") {
        return false;
    }
    if (previousToken.type === "keyword") {
        return !EXPRESSION_ENDING_KEYWORDS.has(previousToken.value);
    }
    if (previousToken.value === ")") {
        return lastClosedControlParenthesis;
    }
    return !isExpressionEndingPunctuator(previousToken.value);
}
function updateGroupingState(groupingStack, previousToken, punctuator) {
    if (punctuator === "(") {
        groupingStack.push({
            value: "(",
            isControlCondition: previousToken?.type === "keyword" && CONTROL_FLOW_PAREN_KEYWORDS.has(previousToken.value)
        });
        return false;
    }
    if (punctuator === "[") {
        groupingStack.push({ value: "[" });
        return false;
    }
    if (punctuator === "{") {
        groupingStack.push({ value: "{" });
        return false;
    }
    if (punctuator === ")" || punctuator === "]" || punctuator === "}") {
        const context = popGroupingContext(groupingStack, matchingOpeningPunctuator(punctuator));
        return punctuator === ")" && context?.isControlCondition === true;
    }
    return false;
}
function popGroupingContext(groupingStack, expected) {
    const context = groupingStack.pop();
    if (context?.value !== expected) {
        return undefined;
    }
    return context;
}
function matchingOpeningPunctuator(value) {
    switch (value) {
        case ")":
            return "(";
        case "]":
            return "[";
        case "}":
            return "{";
    }
}
function isIdentifierStart(char) {
    return char === "_" || char === "$" || isAsciiLetter(char);
}
function isIdentifierPart(char) {
    return isIdentifierStart(char) || isDecimalDigit(char);
}
function readIdentifierAt(source, start) {
    if (!isIdentifierStart(source[start] ?? "")) {
        return undefined;
    }
    let end = start + 1;
    while (end < source.length && isIdentifierPart(source[end] ?? "")) {
        end += 1;
    }
    return {
        value: source.slice(start, end),
        end
    };
}
function isAsciiLetter(char) {
    return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
}
function isDecimalDigit(char) {
    return char >= "0" && char <= "9";
}
function isWhitespace(char) {
    return (char === " " ||
        char === "\t" ||
        char === "\v" ||
        char === "\f" ||
        char === "\u00A0" ||
        char === "\uFEFF");
}
function isLineBreak(char) {
    return char === "\n" || char === "\r";
}
function isExpressionEndingPunctuator(value) {
    return value === ")" || value === "]" || value === "}" || value === "++" || value === "--";
}
