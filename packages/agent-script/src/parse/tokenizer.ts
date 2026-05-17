export type Position = {
  line: number;
  column: number;
  offset: number;
};

export type TokenType = "identifier" | "keyword" | "numeric" | "regex" | "string" | "template" | "punctuator" | "eof";

export type Token = {
  type: TokenType;
  value: string;
  start: Position;
  end: Position;
};

export type TokenizeOptions = {
  allowRegexLiterals?: boolean;
};

const KEYWORDS = new Set([
  "const",
  "let",
  "if",
  "else",
  "for",
  "do",
  "while",
  "return",
  "break",
  "continue",
  "try",
  "catch",
  "finally",
  "throw",
  "async",
  "await",
  "import",
  "from",
  "as",
  "true",
  "false",
  "null",
  "undefined",
  "in",
  "of"
]);

const EXPRESSION_ENDING_KEYWORDS = new Set(["true", "false", "null", "undefined"]);
const CONTROL_FLOW_PAREN_KEYWORDS = new Set(["if", "while", "for", "catch"]);

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
  "??",
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

export function tokenize(source: string, options: TokenizeOptions = {}): Token[] {
  const lexer = new Lexer(source, options);
  return lexer.tokenize();
}

type GroupingContext = {
  value: "(" | "[" | "{";
  isControlCondition?: boolean;
};

class Lexer {
  private index = 0;
  private line = 1;
  private column = 1;
  private readonly tokens: Token[] = [];
  private readonly groupingStack: GroupingContext[] = [];
  private lastClosedControlParenthesis = false;

  constructor(
    private readonly source: string,
    private readonly options: TokenizeOptions
  ) {}

  tokenize(): Token[] {
    while (!this.isAtEnd()) {
      this.skipTrivia();

      if (this.isAtEnd()) {
        break;
      }

      const start = this.position();
      const char = this.currentChar();

      if (isIdentifierStart(char)) {
        this.readIdentifierOrKeyword(start);
        continue;
      }

      if (char === "'" || char === "\"") {
        this.readString(start, char);
        continue;
      }

      if (char === "`") {
        this.readTemplate(start);
        continue;
      }

      if (isDecimalDigit(char) || (char === "." && isDecimalDigit(this.peekChar(1)))) {
        this.readNumber(start);
        continue;
      }

      this.readSlashOrPunctuator(start);
    }

    const end = this.position();
    this.tokens.push({
      type: "eof",
      value: "",
      start: end,
      end
    });
    return this.tokens;
  }

  private skipTrivia(): void {
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
        this.skipBlockComment();
        continue;
      }

      break;
    }
  }

  private readIdentifierOrKeyword(start: Position): void {
    this.advance();
    while (!this.isAtEnd() && isIdentifierPart(this.currentChar())) {
      this.advance();
    }

    const value = this.source.slice(start.offset, this.index);
    this.pushToken(KEYWORDS.has(value) ? "keyword" : "identifier", start, value);
  }

  private readString(start: Position, quote: string): void {
    this.advance();

    while (!this.isAtEnd()) {
      const char = this.currentChar();
      if (char === quote) {
        this.advance();
        this.pushToken("string", start, this.source.slice(start.offset, this.index));
        return;
      }

      if (char === "\\") {
        this.advance();
        if (this.isAtEnd()) {
          break;
        }
        this.advance();
        continue;
      }

      if (isLineBreak(char)) {
        this.syntaxError("Unterminated string literal", start);
      }

      this.advance();
    }

    this.syntaxError("Unterminated string literal", start);
  }

  private readTemplate(start: Position): void {
    this.advance();

    while (!this.isAtEnd()) {
      const char = this.currentChar();

      if (char === "`") {
        this.advance();
        this.pushToken("template", start, this.source.slice(start.offset, this.index));
        return;
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
        this.skipTemplateExpression();
        continue;
      }

      this.advance();
    }

    this.syntaxError("Unterminated template literal", start);
  }

  private skipTemplateExpression(): void {
    let depth = 1;
    const tokens: Array<Pick<Token, "type" | "value">> = [];
    const groupingStack: GroupingContext[] = [];
    let lastClosedControlParenthesis = false;

    while (!this.isAtEnd() && depth > 0) {
      const char = this.currentChar();

      if (char === "'" || char === "\"") {
        this.skipQuotedString(char);
        tokens.push({ type: "string", value: char });
        lastClosedControlParenthesis = false;
        continue;
      }

      if (char === "`") {
        this.skipNestedTemplate();
        tokens.push({ type: "template", value: "`" });
        lastClosedControlParenthesis = false;
        continue;
      }

      if (char === "/" && this.peekChar(1) === "/") {
        this.skipLineComment();
        continue;
      }

      if (char === "/" && this.peekChar(1) === "*") {
        this.skipBlockComment();
        continue;
      }

      if (isIdentifierStart(char)) {
        const start = this.position();
        this.advance();
        while (!this.isAtEnd() && isIdentifierPart(this.currentChar())) {
          this.advance();
        }

        const value = this.source.slice(start.offset, this.index);
        tokens.push({ type: KEYWORDS.has(value) ? "keyword" : "identifier", value });
        lastClosedControlParenthesis = false;
        continue;
      }

      if (isDecimalDigit(char) || (char === "." && isDecimalDigit(this.peekChar(1)))) {
        const start = this.position();
        const value = this.scanNumber(start);
        tokens.push({ type: "numeric", value });
        lastClosedControlParenthesis = false;
        continue;
      }

      if (char === "{") {
        depth += 1;
        this.advance();
        groupingStack.push({ value: "{" });
        tokens.push({ type: "punctuator", value: "{" });
        lastClosedControlParenthesis = false;
        continue;
      }

      if (char === "}") {
        depth -= 1;
        this.advance();

        if (depth === 0) {
          return;
        }

        popGroupingContext(groupingStack, "{");
        tokens.push({ type: "punctuator", value: "}" });
        lastClosedControlParenthesis = false;
        continue;
      }

      if (char === "/" && this.peekChar(1) !== "=" && shouldRejectRegexLiteral(tokens[tokens.length - 1], lastClosedControlParenthesis)) {
        if (!this.options.allowRegexLiterals) {
          this.syntaxError("Regular expression literals are not supported", this.position());
        }

        const start = this.position();
        const value = this.scanRegexLiteral(start);
        tokens.push({ type: "regex", value });
        lastClosedControlParenthesis = false;
        continue;
      }

      const punctuator = matchPunctuator(this.source, this.index);
      if (punctuator !== undefined) {
        const previousToken = tokens[tokens.length - 1];
        this.advanceBy(punctuator.length);
        tokens.push({ type: "punctuator", value: punctuator });
        lastClosedControlParenthesis = updateGroupingState(
          groupingStack,
          previousToken,
          punctuator
        );
        continue;
      }

      this.advance();
    }

    if (depth !== 0) {
      this.syntaxError("Unterminated template expression", this.position());
    }
  }

  private skipQuotedString(quote: string): void {
    const start = this.position();
    this.advance();

    while (!this.isAtEnd()) {
      const char = this.currentChar();
      if (char === quote) {
        this.advance();
        return;
      }
      if (char === "\\") {
        this.advance();
        if (!this.isAtEnd()) {
          this.advance();
        }
        continue;
      }
      if (isLineBreak(char)) {
        this.syntaxError("Unterminated string literal", start);
      }
      this.advance();
    }

    this.syntaxError("Unterminated string literal", start);
  }

  private skipNestedTemplate(): void {
    const start = this.position();
    this.advance();

    while (!this.isAtEnd()) {
      const char = this.currentChar();
      if (char === "`") {
        this.advance();
        return;
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
        this.skipTemplateExpression();
        continue;
      }
      this.advance();
    }

    this.syntaxError("Unterminated template literal", start);
  }

  private skipLineComment(): void {
    this.advance();
    this.advance();
    while (!this.isAtEnd() && !isLineBreak(this.currentChar())) {
      this.advance();
    }
  }

  private skipBlockComment(): void {
    const start = this.position();
    this.advance();
    this.advance();

    while (!this.isAtEnd()) {
      if (this.currentChar() === "*" && this.peekChar(1) === "/") {
        this.advance();
        this.advance();
        return;
      }
      this.advance();
    }

    this.syntaxError("Unterminated block comment", start);
  }

  private readNumber(start: Position): void {
    const value = this.scanNumber(start);
    this.pushToken("numeric", start, value);
  }

  private scanNumber(start: Position): string {
    if (this.currentChar() === ".") {
      this.advance();
      this.consumeDecimalDigits();
      this.consumeExponent();
      this.rejectBigIntSuffix();
      this.rejectInvalidNumericLiteralContinuation();
      return this.source.slice(start.offset, this.index);
    }

    if (this.currentChar() === "0") {
      const prefix = this.peekChar(1);
      if (prefix === "x" || prefix === "X") {
        this.advance();
        this.advance();
        this.consumeDigitsForBase(isHexDigit, "hexadecimal");
        this.rejectBigIntSuffix();
        this.rejectInvalidNumericLiteralContinuation();
        return this.source.slice(start.offset, this.index);
      }
      if (prefix === "b" || prefix === "B") {
        this.advance();
        this.advance();
        this.consumeDigitsForBase(isBinaryDigit, "binary");
        this.rejectBigIntSuffix();
        this.rejectInvalidNumericLiteralContinuation();
        return this.source.slice(start.offset, this.index);
      }
      if (prefix === "o" || prefix === "O") {
        this.advance();
        this.advance();
        this.consumeDigitsForBase(isOctalDigit, "octal");
        this.rejectBigIntSuffix();
        this.rejectInvalidNumericLiteralContinuation();
        return this.source.slice(start.offset, this.index);
      }
    }

    this.consumeDecimalDigits();

    if (this.currentChar() === "." && (this.peekChar(1) !== "." || this.peekChar(2) !== ".")) {
      this.advance();
      this.consumeOptionalDecimalDigits();
    }

    this.consumeExponent();
    this.rejectBigIntSuffix();
    this.rejectInvalidNumericLiteralContinuation();
    return this.source.slice(start.offset, this.index);
  }

  private consumeDecimalDigits(): void {
    this.consumeDigitsForBase(isDecimalDigit, "decimal");
  }

  private consumeOptionalDecimalDigits(): void {
    let consumedDigit = false;
    let lastWasSeparator = false;

    while (!this.isAtEnd()) {
      const char = this.currentChar();
      if (isDecimalDigit(char)) {
        consumedDigit = true;
        lastWasSeparator = false;
        this.advance();
        continue;
      }

      if (char === "_") {
        if (!consumedDigit || lastWasSeparator || !isDecimalDigit(this.peekChar(1))) {
          this.syntaxError("Invalid decimal numeric literal", this.position());
        }
        lastWasSeparator = true;
        this.advance();
        continue;
      }

      break;
    }

    if (lastWasSeparator) {
      this.syntaxError("Invalid decimal numeric literal", this.position());
    }
  }

  private consumeDigitsForBase(isValidDigit: (char: string) => boolean, label: string): void {
    let consumedDigit = false;
    let lastWasSeparator = false;

    while (!this.isAtEnd()) {
      const char = this.currentChar();
      if (isValidDigit(char)) {
        consumedDigit = true;
        lastWasSeparator = false;
        this.advance();
        continue;
      }

      if (char === "_") {
        if (!consumedDigit || lastWasSeparator || !isValidDigit(this.peekChar(1))) {
          this.syntaxError(`Invalid ${label} numeric literal`, this.position());
        }
        lastWasSeparator = true;
        this.advance();
        continue;
      }

      break;
    }

    if (!consumedDigit || lastWasSeparator) {
      this.syntaxError(`Invalid ${label} numeric literal`, this.position());
    }
  }

  private consumeExponent(): void {
    const char = this.currentChar();
    if (char !== "e" && char !== "E") {
      return;
    }

    const exponentStart = this.position();
    this.advance();

    if (this.currentChar() === "+" || this.currentChar() === "-") {
      this.advance();
    }

    let consumedDigit = false;
    let lastWasSeparator = false;

    while (!this.isAtEnd()) {
      const next = this.currentChar();
      if (isDecimalDigit(next)) {
        consumedDigit = true;
        lastWasSeparator = false;
        this.advance();
        continue;
      }

      if (next === "_") {
        if (!consumedDigit || lastWasSeparator || !isDecimalDigit(this.peekChar(1))) {
          this.syntaxError("Invalid decimal numeric literal", this.position());
        }
        lastWasSeparator = true;
        this.advance();
        continue;
      }

      break;
    }

    if (!consumedDigit || lastWasSeparator) {
      this.syntaxError("Invalid decimal numeric literal", exponentStart);
    }
  }

  private rejectBigIntSuffix(): void {
    if (this.currentChar() === "n") {
      this.syntaxError("BigInt literals are not supported", this.position());
    }
  }

  private rejectInvalidNumericLiteralContinuation(): void {
    const char = this.currentChar();
    if (char === "_" || isIdentifierStart(char) || isDecimalDigit(char)) {
      this.syntaxError("Invalid numeric literal", this.position());
    }
  }

  private readSlashOrPunctuator(start: Position): void {
    if (this.currentChar() === "/" && this.peekChar(1) !== "=" && shouldRejectRegexLiteral(this.lastSignificantToken(), this.lastClosedControlParenthesis)) {
      if (!this.options.allowRegexLiterals) {
        this.syntaxError("Regular expression literals are not supported", start);
      }

      this.pushToken("regex", start, this.scanRegexLiteral(start));
      return;
    }

    const punctuator = matchPunctuator(this.source, this.index);
    if (punctuator !== undefined) {
      this.advanceBy(punctuator.length);
      this.pushToken("punctuator", start, punctuator);
      return;
    }

    this.syntaxError(`Unexpected character '${this.currentChar()}'`, start);
  }

  private lastSignificantToken(): Token | undefined {
    for (let index = this.tokens.length - 1; index >= 0; index -= 1) {
      const token = this.tokens[index];
      if (token.type !== "eof") {
        return token;
      }
    }
    return undefined;
  }

  private scanRegexLiteral(start: Position): string {
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

    return this.source.slice(start.offset, this.index);
  }

  private pushToken(type: TokenType, start: Position, value: string): void {
    const previousToken = this.lastSignificantToken();
    const token = {
      type,
      value,
      start,
      end: this.position()
    };

    this.tokens.push(token);

    if (type === "punctuator") {
      this.lastClosedControlParenthesis = updateGroupingState(
        this.groupingStack,
        previousToken,
        value
      );
      return;
    }

    this.lastClosedControlParenthesis = false;
  }

  private currentChar(): string {
    return this.source[this.index] ?? "";
  }

  private peekChar(distance: number): string {
    return this.source[this.index + distance] ?? "";
  }

  private isAtEnd(): boolean {
    return this.index >= this.source.length;
  }

  private position(): Position {
    return {
      line: this.line,
      column: this.column,
      offset: this.index
    };
  }

  private advance(): void {
    if (this.isAtEnd()) {
      return;
    }

    const char = this.currentChar();
    if (char === "\r") {
      this.index += 1;
      if (this.currentChar() === "\n") {
        this.index += 1;
      }
      this.line += 1;
      this.column = 1;
      return;
    }

    this.index += 1;
    if (char === "\n") {
      this.line += 1;
      this.column = 1;
      return;
    }

    this.column += 1;
  }

  private advanceBy(length: number): void {
    for (let index = 0; index < length; index += 1) {
      this.advance();
    }
  }

  private syntaxError(message: string, position: Position): never {
    throw new Error(`${message} at line ${position.line}, column ${position.column}.`);
  }
}

function isIdentifierStart(char: string): boolean {
  return isAsciiLetter(char) || char === "_" || char === "$";
}

function isIdentifierPart(char: string): boolean {
  return isIdentifierStart(char) || isDecimalDigit(char);
}

function isAsciiLetter(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
}

function isDecimalDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isHexDigit(char: string): boolean {
  return isDecimalDigit(char) || (char >= "a" && char <= "f") || (char >= "A" && char <= "F");
}

function isBinaryDigit(char: string): boolean {
  return char === "0" || char === "1";
}

function isOctalDigit(char: string): boolean {
  return char >= "0" && char <= "7";
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\v" || char === "\f";
}

function isLineBreak(char: string): boolean {
  return char === "\n" || char === "\r";
}

function isExpressionEndingPunctuator(value: string): boolean {
  return value === ")" || value === "]" || value === "}" || value === "++" || value === "--";
}

function matchPunctuator(source: string, index: number): string | undefined {
  return PUNCTUATORS.find(punctuator => source.startsWith(punctuator, index));
}

function shouldRejectRegexLiteral(
  previousToken: Pick<Token, "type" | "value"> | undefined,
  lastClosedControlParenthesis: boolean
): boolean {
  if (previousToken === undefined) {
    return true;
  }

  if (
    previousToken.type === "identifier" ||
    previousToken.type === "numeric" ||
    previousToken.type === "string" ||
    previousToken.type === "template"
  ) {
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

function updateGroupingState(
  groupingStack: GroupingContext[],
  previousToken: Pick<Token, "type" | "value"> | undefined,
  punctuator: string
): boolean {
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

  if (punctuator === ")") {
    return popGroupingContext(groupingStack, "(")?.isControlCondition === true;
  }

  if (punctuator === "]") {
    popGroupingContext(groupingStack, "[");
    return false;
  }

  if (punctuator === "}") {
    popGroupingContext(groupingStack, "{");
    return false;
  }

  return false;
}

function popGroupingContext(
  groupingStack: GroupingContext[],
  expected: GroupingContext["value"]
): GroupingContext | undefined {
  const top = groupingStack[groupingStack.length - 1];
  if (top?.value !== expected) {
    return undefined;
  }

  return groupingStack.pop();
}
