import type { SourceSpan } from "../../parse/parser.js";
import type { Position } from "../../parse/tokenizer.js";

export type Diagnostic = {
  code: "AS001";
  severity: "error";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

export function AS001(source: string, options: { filename?: string } = {}): Diagnostic[] {
  return new AS001Scanner(source, options.filename ?? "<input>").scan();
}

type TokenType =
  | "eof"
  | "identifier"
  | "keyword"
  | "numeric"
  | "punctuator"
  | "regex"
  | "string"
  | "template";

type Token = {
  type: TokenType;
  value: string;
  start: Position;
  end: Position;
};

type GroupingContext = {
  value: "(" | "[" | "{";
  isControlCondition?: boolean;
};

type BraceContext = {
  kind: "class" | "object" | "statement";
};

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
  private index = 0;
  private line = 1;
  private column = 1;
  private readonly diagnostics: Diagnostic[] = [];

  constructor(
    private readonly source: string,
    private readonly filename: string
  ) {}

  scan(): Diagnostic[] {
    this.scanCode();
    return this.diagnostics;
  }

  private scanCode(stopAtTemplateExpressionEnd = false): void {
    let previousToken: Token | undefined;
    let previousPreviousToken: Token | undefined;
    const groupingStack: GroupingContext[] = [];
    const braceContextStack: BraceContext[] = [];
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

      let token: Token;

      if (isIdentifierStart(char)) {
        token = this.readIdentifierOrKeyword(start);
      } else if (char === "'" || char === '"') {
        token = this.readString(start, char);
      } else if (char === "`") {
        token = this.readTemplate(start);
      } else if (isDecimalDigit(char) || (char === "." && isDecimalDigit(this.peekChar(1)))) {
        token = this.readNumber(start);
      } else if (
        char === "/" &&
        this.peekChar(1) !== "=" &&
        shouldRejectRegexLiteral(previousToken, lastClosedControlParenthesis)
      ) {
        token = this.readRegexLiteral(start);
      } else {
        token = this.readPunctuator(start);
      }

      if (token.type === "identifier" || token.type === "keyword") {
        const nextSignificantChar = this.peekNextSignificantChar();
        const isMemberProperty =
          previousToken?.type === "punctuator" &&
          (previousToken.value === "." || previousToken.value === "?.");
        const isPropertyKey = nextSignificantChar === ":" && !canStartStatement;
        const isMemberName = isMemberNameToken(
          token,
          previousToken,
          previousPreviousToken,
          braceContextStack,
          nextSignificantChar
        );

        if (
          canStartStatement &&
          nextSignificantChar === ":" &&
          token.value !== "default" &&
          !this.isLoopLabelStart()
        ) {
          this.report(
            "label",
            token.start,
            this.positionWithinSource(token.start.offset + token.value.length)
          );
        } else if (!isMemberProperty && !isPropertyKey && !isMemberName) {
          this.reportForbiddenIdentifier(token);
          if (token.value === "class") {
            pendingClassBody = true;
          }
        }
      }

      const isStatementBrace =
        token.type === "punctuator" && token.value === "{" && canStartStatement;

      if (token.type === "punctuator" && token.value === "{") {
        braceContextStack.push({
          kind:
            pendingClassBody && !canStartStatement
              ? "class"
              : isStatementBrace
                ? "statement"
                : "object"
        });
        pendingClassBody = false;
        if (stopAtTemplateExpressionEnd) {
          templateExpressionBraceDepth += 1;
        }
      } else if (token.type === "punctuator" && token.value === "}") {
        const closedBraceContext = braceContextStack.pop();
        const closedStatementBrace = closedBraceContext?.kind === "statement";
        if (stopAtTemplateExpressionEnd) {
          templateExpressionBraceDepth -= 1;
        }
        lastClosedControlParenthesis =
          token.type === "punctuator"
            ? updateGroupingState(groupingStack, previousToken, token.value)
            : false;
        canStartStatement = updateStatementStart(
          token,
          lastClosedControlParenthesis,
          false,
          closedStatementBrace
        );
        previousPreviousToken = previousToken;
        previousToken = token;
        continue;
      }

      if (
        token.type === "punctuator" &&
        token.value === "*" &&
        isGeneratorMemberToken(previousToken, previousPreviousToken, braceContextStack)
      ) {
        this.report("generator", token.start, token.end);
      }

      lastClosedControlParenthesis =
        token.type === "punctuator"
          ? updateGroupingState(groupingStack, previousToken, token.value)
          : false;
      canStartStatement = updateStatementStart(
        token,
        lastClosedControlParenthesis,
        isStatementBrace,
        false
      );
      previousPreviousToken = previousToken;
      previousToken = token;
    }
  }

  private reportForbiddenIdentifier(token: Token): void {
    switch (token.value) {
      case "eval":
      case "Function":
      case "with":
        this.report(token.value, token.start, token.end);
        return;
      default:
        return;
    }
  }

  private report(construct: string, start: Position, end: Position): void {
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

  private readIdentifierOrKeyword(start: Position): Token {
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

  private readString(start: Position, quote: string): Token {
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

  private readTemplate(start: Position): Token {
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

  private readNumber(start: Position): Token {
    if (this.currentChar() === ".") {
      this.advance();
      while (!this.isAtEnd() && isDecimalDigit(this.currentChar())) {
        this.advance();
      }
    } else {
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

  private readRegexLiteral(start: Position): Token {
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

  private readPunctuator(start: Position): Token {
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

  private peekNextSignificantChar(): string | undefined {
    const nextIndex = this.skipTriviaFrom(this.index);
    return nextIndex >= this.source.length ? undefined : this.source[nextIndex];
  }

  private isLoopLabelStart(): boolean {
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

  private skipTriviaFrom(start: number): number {
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

  private currentChar(): string {
    return this.source[this.index] ?? "";
  }

  private peekChar(offset: number): string {
    return this.source[this.index + offset] ?? "";
  }

  private advance(): void {
    const char = this.source[this.index];
    this.index += 1;
    if (isLineBreak(char)) {
      if (char !== "\n" || this.source[this.index - 2] !== "\r") this.line += 1;
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

  private positionWithinSource(offset: number): Position {
    let line = 1;
    let column = 1;

    for (let index = 0; index < offset; index += 1) {
      if (isLineBreak(this.source[index])) {
        if (this.source[index] !== "\n" || this.source[index - 1] !== "\r") line += 1;
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

function createSpan(start: Position, end: Position): SourceSpan {
  return {
    start: { ...start },
    end: { ...end }
  };
}

function isMemberNameToken(
  token: Token,
  previousToken: Token | undefined,
  previousPreviousToken: Token | undefined,
  braceContextStack: BraceContext[],
  nextSignificantChar: string | undefined
): boolean {
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

function isGeneratorMemberToken(
  previousToken: Token | undefined,
  previousPreviousToken: Token | undefined,
  braceContextStack: BraceContext[]
): boolean {
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

  return (
    isMemberModifierToken(previousToken) &&
    isMemberEntryStart(previousPreviousToken, memberContext.kind)
  );
}

function isMemberEntryStart(token: Token | undefined, kind: BraceContext["kind"]): boolean {
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

function isMemberModifierToken(token: Token | undefined): boolean {
  if (token === undefined) {
    return false;
  }

  if (token.type !== "identifier" && token.type !== "keyword") {
    return false;
  }

  return (
    token.value === "async" ||
    token.value === "get" ||
    token.value === "set" ||
    token.value === "static"
  );
}

function updateStatementStart(
  token: Token,
  lastClosedControlParenthesis: boolean,
  isStatementBrace: boolean,
  closedStatementBrace: boolean
): boolean {
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

function matchPunctuator(source: string, index: number): string | undefined {
  return PUNCTUATORS.find((punctuator) => source.startsWith(punctuator, index));
}

function shouldRejectRegexLiteral(
  previousToken: Token | undefined,
  lastClosedControlParenthesis: boolean
): boolean {
  if (previousToken === undefined) {
    return true;
  }

  if (
    previousToken.type === "identifier" ||
    previousToken.type === "numeric" ||
    previousToken.type === "regex" ||
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
  previousToken: Token | undefined,
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

  if (punctuator === ")" || punctuator === "]" || punctuator === "}") {
    const context = popGroupingContext(groupingStack, matchingOpeningPunctuator(punctuator));
    return punctuator === ")" && context?.isControlCondition === true;
  }

  return false;
}

function popGroupingContext(
  groupingStack: GroupingContext[],
  expected: "(" | "[" | "{"
): GroupingContext | undefined {
  const context = groupingStack.pop();
  if (context?.value !== expected) {
    return undefined;
  }
  return context;
}

function matchingOpeningPunctuator(value: ")" | "]" | "}"): "(" | "[" | "{" {
  switch (value) {
    case ")":
      return "(";
    case "]":
      return "[";
    case "}":
      return "{";
  }
}

function isIdentifierStart(char: string): boolean {
  return char === "_" || char === "$" || isAsciiLetter(char);
}

function isIdentifierPart(char: string): boolean {
  return isIdentifierStart(char) || isDecimalDigit(char);
}

function readIdentifierAt(
  source: string,
  start: number
): { value: string; end: number } | undefined {
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

function isAsciiLetter(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
}

function isDecimalDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isWhitespace(char: string): boolean {
  return (
    char === " " ||
    char === "\t" ||
    char === "\v" ||
    char === "\f" ||
    char === "\u00A0" ||
    char === "\uFEFF"
  );
}

function isLineBreak(char: string): boolean {
  return char === "\n" || char === "\r";
}

function isExpressionEndingPunctuator(value: string): boolean {
  return value === ")" || value === "]" || value === "}" || value === "++" || value === "--";
}
