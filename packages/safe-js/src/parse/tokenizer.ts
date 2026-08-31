import { RegexCompileGuard, type CompileScope } from "../interp/regex/compile-guard.js";

export type Position = {
  line: number;
  column: number;
  offset: number;
};

export type TokenType =
  | "identifier"
  | "keyword"
  | "numeric"
  | "regex"
  | "string"
  | "template"
  | "punctuator"
  | "eof";

export type Token = {
  type: TokenType;
  value: string;
  start: Position;
  end: Position;
};

export type Comment = {
  type: "block" | "line";
  value: string;
  start: Position;
  end: Position;
};

export type TokenizeOptions = {
  allowRegexLiterals?: boolean;
  comments?: Comment[];
  compilation?: CompileScope;
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
  "function",
  "async",
  "await",
  "yield",
  "import",
  "as",
  "true",
  "false",
  "null",
  "undefined",
  "typeof",
  "void",
  "delete",
  "this",
  "instanceof",
  "in",
  "of"
]);

const EXPRESSION_ENDING_KEYWORDS = new Set(["true", "false", "null", "undefined"]);
const CONTROL_FLOW_PAREN_KEYWORDS = new Set(["if", "while", "for", "catch"]);
const MAX_UNICODE_CODE_POINT = 0x10ffff;
const IDENTIFIER_START_PATTERN = /^\p{ID_Start}$/u;
const IDENTIFIER_PART_PATTERN = /^\p{ID_Continue}$/u;

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

export function collectComments(source: string): Comment[] {
  const comments: Comment[] = [];
  tokenize(source, { allowRegexLiterals: true, comments });
  return comments;
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
      const codePointChar = this.currentCodePointChar();

      if (this.isHtmlStyleCommentDelimiter()) {
        this.syntaxError("HTML-style comments are not supported in Agent Script", start);
      }

      if (char === "*" && this.peekChar(1) === "/") {
        this.syntaxError("Unexpected block comment terminator", start);
      }

      if (isIdentifierStart(codePointChar) || this.startsUnicodeEscape()) {
        this.readIdentifierOrKeyword(start);
        continue;
      }

      if (char === "'" || char === '"') {
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

      if (this.isHashbangCommentStart()) {
        this.skipLineComment();
        continue;
      }

      if (isWhitespace(char) || isLineBreak(char)) {
        this.advance();
        continue;
      }

      if (char === "/" && this.peekChar(1) === "/") {
        const start = this.position();
        this.advance();
        this.advance();
        const valueStart = this.index;
        while (!this.isAtEnd() && !isLineBreak(this.currentChar())) {
          this.advance();
        }
        this.recordComment("line", start, valueStart);
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
    let value = "";
    let isStart = true;

    while (!this.isAtEnd()) {
      if (this.startsUnicodeEscape()) {
        const escapeStart = this.position();
        const escaped = this.readUnicodeEscape();
        const isValidIdentifierCharacter = isStart
          ? isIdentifierStart(escaped)
          : isIdentifierPart(escaped);

        if (!isValidIdentifierCharacter) {
          this.syntaxError("Invalid identifier escape", escapeStart);
        }

        value += escaped;
        isStart = false;
        continue;
      }

      const char = this.currentCodePointChar();
      const isValidIdentifierCharacter = isStart ? isIdentifierStart(char) : isIdentifierPart(char);

      if (!isValidIdentifierCharacter) {
        break;
      }

      this.advanceBy(char.length);
      value += char;
      isStart = false;
    }

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
        this.readEscapedLiteralCharacter();
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
        this.skipEscapedTemplateCharacter();
        continue;
      }

      if (char === "$" && this.peekChar(1) === "{") {
        const expressionStart = this.position();
        this.advance();
        this.advance();
        this.skipTemplateExpression(expressionStart);
        continue;
      }

      this.advance();
    }

    this.syntaxError("Unterminated template literal", start);
  }

  private skipTemplateExpression(start: Position): void {
    let depth = 1;
    const tokens: Array<Pick<Token, "type" | "value">> = [];
    const groupingStack: GroupingContext[] = [];
    let lastClosedControlParenthesis = false;

    while (!this.isAtEnd() && depth > 0) {
      const char = this.currentChar();

      if (this.isHtmlStyleCommentDelimiter()) {
        this.syntaxError("HTML-style comments are not supported in Agent Script", this.position());
      }

      if (char === "'" || char === '"') {
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

      if (char === "*" && this.peekChar(1) === "/") {
        this.syntaxError("Unexpected block comment terminator", this.position());
      }

      if (isIdentifierStart(this.currentCodePointChar()) || this.startsUnicodeEscape()) {
        let value = "";
        let isStart = true;

        while (!this.isAtEnd()) {
          if (this.startsUnicodeEscape()) {
            const escapeStart = this.position();
            const escaped = this.readUnicodeEscape();
            const isValidIdentifierCharacter = isStart
              ? isIdentifierStart(escaped)
              : isIdentifierPart(escaped);

            if (!isValidIdentifierCharacter) {
              this.syntaxError("Invalid identifier escape", escapeStart);
            }

            value += escaped;
            isStart = false;
            continue;
          }

          const identifierChar = this.currentCodePointChar();
          const isValidIdentifierCharacter = isStart
            ? isIdentifierStart(identifierChar)
            : isIdentifierPart(identifierChar);

          if (!isValidIdentifierCharacter) {
            break;
          }

          this.advanceBy(identifierChar.length);
          value += identifierChar;
          isStart = false;
        }

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

      if (
        char === "/" &&
        this.peekChar(1) !== "=" &&
        shouldRejectRegexLiteral(tokens[tokens.length - 1], lastClosedControlParenthesis)
      ) {
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
      this.syntaxError("Unterminated template expression", start);
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
        this.readEscapedLiteralCharacter();
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
        this.skipEscapedTemplateCharacter();
        continue;
      }
      if (char === "$" && this.peekChar(1) === "{") {
        const expressionStart = this.position();
        this.advance();
        this.advance();
        this.skipTemplateExpression(expressionStart);
        continue;
      }
      this.advance();
    }

    this.syntaxError("Unterminated template literal", start);
  }

  private skipLineComment(): void {
    const start = this.position();
    this.advance();
    this.advance();
    const valueStart = this.index;
    while (!this.isAtEnd() && !isLineBreak(this.currentChar())) {
      this.advance();
    }
    this.recordComment("line", start, valueStart);
  }

  private skipBlockComment(): void {
    const start = this.position();
    this.advance();
    this.advance();
    const valueStart = this.index;

    while (!this.isAtEnd()) {
      if (this.currentChar() === "*" && this.peekChar(1) === "/") {
        const valueEnd = this.index;
        this.advance();
        this.advance();
        this.recordComment("block", start, valueStart, valueEnd);
        return;
      }
      this.advance();
    }

    this.syntaxError("Unterminated block comment", start);
  }

  private recordComment(
    type: Comment["type"],
    start: Position,
    valueStart: number,
    valueEnd = this.index
  ): void {
    this.options.comments?.push({
      type,
      value: this.source.slice(valueStart, valueEnd),
      start,
      end: this.position()
    });
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

      if (isDecimalDigit(prefix)) {
        // Agent Script uses strict-mode JavaScript numeric grammar, so legacy octal
        // and non-octal leading-zero decimal literals are not accepted.
        this.advance();
        this.syntaxError("Legacy octal numeric literals are not supported in strict mode", start);
      }

      if (prefix === "_") {
        this.advance();
        this.syntaxError("Invalid decimal numeric literal", this.position());
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
      this.syntaxError("BigInt not supported", this.position());
    }
  }

  private rejectInvalidNumericLiteralContinuation(): void {
    const char = this.currentChar();
    if (
      char === "_" ||
      isIdentifierStart(this.currentCodePointChar()) ||
      isDecimalDigit(char) ||
      this.startsUnicodeEscape()
    ) {
      this.syntaxError("Invalid number", this.position());
    }
  }

  private readSlashOrPunctuator(start: Position): void {
    if (
      this.currentChar() === "/" &&
      this.peekChar(1) !== "=" &&
      shouldRejectRegexLiteral(this.lastSignificantToken(), this.lastClosedControlParenthesis)
    ) {
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
    const guard = new RegexCompileGuard(this.options.compilation);
    try {
      guard.work(1);
      this.advance();
      const patternStart = this.index;
      let inCharacterClass = false;
      const advancePattern = () => {
        const width = this.currentChar() === "\r" && this.peekChar(1) === "\n" ? 2 : 1;
        guard.checkLength(this.index - patternStart + width);
        guard.work(width);
        this.advance();
      };
      while (!this.isAtEnd()) {
        const char = this.currentChar();
        if (char === "\\") {
          advancePattern();
          if (!this.isAtEnd()) advancePattern();
          continue;
        }
        if (char === "[" && !inCharacterClass) {
          inCharacterClass = true;
          advancePattern();
          continue;
        }
        if (char === "]" && inCharacterClass) {
          inCharacterClass = false;
          advancePattern();
          continue;
        }
        if (char === "/" && !inCharacterClass) {
          guard.work(1);
          this.advance();
          const flagsStart = this.index;
          while (!this.isAtEnd() && isAsciiLetter(this.currentChar())) {
            guard.checkLength(this.index - flagsStart + 1, true);
            guard.work(1);
            this.advance();
          }
          break;
        }
        advancePattern();
      }
      guard.allocate(this.index - start.offset);
      guard.work(this.index - start.offset);
      const raw = this.source.slice(start.offset, this.index);
      guard.retainScratch();
      return raw;
    } finally {
      guard.close();
    }
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

  private currentCodePointChar(): string {
    const codePoint = this.source.codePointAt(this.index);
    return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
  }

  private startsUnicodeEscape(): boolean {
    return this.currentChar() === "\\" && this.peekChar(1) === "u";
  }

  private isHtmlStyleCommentDelimiter(): boolean {
    return this.source.startsWith("<!--", this.index) || this.source.startsWith("-->", this.index);
  }

  private isHashbangCommentStart(): boolean {
    return (
      this.source.startsWith("#!", this.index) &&
      (this.index === 0 || (this.index === 1 && this.source[0] === "\uFEFF"))
    );
  }

  private readUnicodeEscape(): string {
    const escapeStart = this.position();
    this.advance();
    return this.readUnicodeEscapeAfterBackslash(escapeStart);
  }

  private readUnicodeEscapeAfterBackslash(escapeStart: Position): string {
    this.advance();

    if (this.currentChar() === "{") {
      return this.readExtendedUnicodeEscape(escapeStart);
    }

    let value = "";
    for (let index = 0; index < 4; index += 1) {
      const char = this.currentChar();
      if (!isHexDigit(char)) {
        this.syntaxError("Invalid unicode escape", escapeStart);
      }
      value += char;
      this.advance();
    }

    return String.fromCharCode(Number.parseInt(value, 16));
  }

  private readEscapedLiteralCharacter(): void {
    const escapeStart = this.position();
    this.advance();

    if (this.isAtEnd()) {
      return;
    }

    const escaped = this.currentChar();
    if (escaped === "u") {
      this.readUnicodeEscapeAfterBackslash(escapeStart);
      return;
    }

    if (escaped === "x") {
      this.advance();
      for (let index = 0; index < 2; index += 1) {
        if (!isHexDigit(this.currentChar())) {
          this.syntaxError("Invalid hex escape", escapeStart);
        }
        this.advance();
      }
      return;
    }

    if (escaped === "0") {
      this.advance();
      if (isDecimalDigit(this.currentChar())) {
        this.syntaxError("Legacy octal escape sequences are not supported", escapeStart);
      }
      return;
    }

    if (isOctalDigit(escaped)) {
      this.syntaxError("Legacy octal escape sequences are not supported", escapeStart);
    }

    this.advance();
  }

  private skipEscapedTemplateCharacter(): void {
    this.advance();

    if (this.isAtEnd()) {
      return;
    }

    const escaped = this.currentChar();
    if (escaped === "\r") {
      this.advance();
      if (this.currentChar() === "\n") {
        this.advance();
      }
      return;
    }

    this.advance();
  }

  private readExtendedUnicodeEscape(escapeStart: Position): string {
    this.advance();
    const codePointStart = this.position();
    let value = "";

    while (!this.isAtEnd() && this.currentChar() !== "}") {
      const char = this.currentChar();
      if (!isHexDigit(char)) {
        this.syntaxError("Invalid unicode escape", this.position());
      }

      value += char;
      this.advance();
    }

    if (value.length === 0) {
      this.syntaxError("Invalid unicode escape", escapeStart);
    }

    if (this.isAtEnd()) {
      this.syntaxError("Invalid unicode escape", escapeStart);
    }

    const codePoint = Number.parseInt(value, 16);
    if (codePoint > MAX_UNICODE_CODE_POINT) {
      this.syntaxError("Invalid unicode escape", codePointStart);
    }

    this.advance();
    return String.fromCodePoint(codePoint);
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
  return char === "_" || char === "$" || IDENTIFIER_START_PATTERN.test(char);
}

function isIdentifierPart(char: string): boolean {
  return (
    isIdentifierStart(char) ||
    isDecimalDigit(char) ||
    char === "\u200c" ||
    char === "\u200d" ||
    IDENTIFIER_PART_PATTERN.test(char)
  );
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
  return char === " " || char === "\t" || char === "\v" || char === "\f" || char === "\uFEFF";
}

function isLineBreak(char: string): boolean {
  return char === "\n" || char === "\r";
}

function isExpressionEndingPunctuator(value: string): boolean {
  return value === ")" || value === "]" || value === "}" || value === "++" || value === "--";
}

function matchPunctuator(source: string, index: number): string | undefined {
  return PUNCTUATORS.find(
    (punctuator) =>
      source.startsWith(punctuator, index) &&
      (punctuator !== "?." || !isDecimalDigit(source[index + 2] ?? ""))
  );
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
      isControlCondition:
        previousToken?.type === "keyword" && CONTROL_FLOW_PAREN_KEYWORDS.has(previousToken.value)
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
