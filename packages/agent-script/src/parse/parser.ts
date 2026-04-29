import { tokenize, type Position, type Token } from "./tokenizer.js";

export type SourceSpan = {
  start: Position;
  end: Position;
};

type BaseNode = {
  type: string;
  span: SourceSpan;
};

export type Identifier = BaseNode & {
  type: "Identifier";
  name: string;
};

export type NumericLiteral = BaseNode & {
  type: "NumericLiteral";
  raw: string;
  value: number;
};

export type StringLiteral = BaseNode & {
  type: "StringLiteral";
  raw: string;
  value: string;
};

export type BooleanLiteral = BaseNode & {
  type: "BooleanLiteral";
  raw: "true" | "false";
  value: boolean;
};

export type NullLiteral = BaseNode & {
  type: "NullLiteral";
  raw: "null";
  value: null;
};

export type UndefinedLiteral = BaseNode & {
  type: "UndefinedLiteral";
  raw: "undefined";
  value: undefined;
};

export type TemplateElement = BaseNode & {
  type: "TemplateElement";
  tail: boolean;
  value: {
    raw: string;
    cooked: string;
  };
};

export type TemplateLiteral = BaseNode & {
  type: "TemplateLiteral";
  expressions: Expression[];
  quasis: TemplateElement[];
};

export type SpreadElement = BaseNode & {
  type: "SpreadElement";
  argument: Expression;
};

export type Property = BaseNode & {
  type: "Property";
  computed: boolean;
  shorthand: boolean;
  key: Expression;
  value: Expression;
};

export type ArrayExpression = BaseNode & {
  type: "ArrayExpression";
  elements: Array<Expression | SpreadElement>;
};

export type ObjectExpression = BaseNode & {
  type: "ObjectExpression";
  properties: Array<Property | SpreadElement>;
};

export type Expression =
  | ArrayExpression
  | BooleanLiteral
  | Identifier
  | NullLiteral
  | NumericLiteral
  | ObjectExpression
  | SpreadElement
  | StringLiteral
  | TemplateLiteral
  | UndefinedLiteral;

export function parse(source: string): Expression {
  return new Parser(tokenize(source)).parse();
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Expression {
    const expression = this.parseExpression();
    while (this.consumePunctuator(";") !== undefined) {
      continue;
    }
    this.expectEof();
    return expression;
  }

  private parseExpression(): Expression {
    const token = this.currentToken();

    if (token.type === "identifier") {
      this.index += 1;
      return createIdentifier(token);
    }

    if (token.type === "numeric") {
      this.index += 1;
      return createNumericLiteral(token);
    }

    if (token.type === "string") {
      this.index += 1;
      return createStringLiteral(token);
    }

    if (token.type === "template") {
      this.index += 1;
      return createTemplateLiteral(token);
    }

    if (token.type === "keyword") {
      this.index += 1;
      return createKeywordLiteral(token);
    }

    if (token.type === "punctuator" && token.value === "[") {
      return this.parseArrayExpression();
    }

    if (token.type === "punctuator" && token.value === "{") {
      return this.parseObjectExpression();
    }

    throw unexpectedTokenError(token);
  }

  private parseArrayExpression(): ArrayExpression {
    const start = this.expectPunctuator("[");
    const elements: Array<Expression | SpreadElement> = [];

    const emptyEnd = this.consumePunctuator("]");
    if (emptyEnd !== undefined) {
      return {
        type: "ArrayExpression",
        elements,
        span: createSpan(start.start, emptyEnd.end)
      };
    }

    while (true) {
      if (this.currentToken().type === "punctuator" && this.currentToken().value === ",") {
        throw unexpectedTokenError(this.currentToken());
      }

      if (this.consumePunctuator("...") !== undefined) {
        const spreadStart = this.previousToken();
        const argument = this.parseExpression();
        elements.push({
          type: "SpreadElement",
          argument,
          span: createSpan(spreadStart.start, argument.span.end)
        });
      } else {
        elements.push(this.parseExpression());
      }

      if (this.consumePunctuator(",") !== undefined) {
        if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
          break;
        }
        continue;
      }

      break;
    }

    const end = this.expectPunctuator("]");
    return {
      type: "ArrayExpression",
      elements,
      span: createSpan(start.start, end.end)
    };
  }

  private parseObjectExpression(): ObjectExpression {
    const start = this.expectPunctuator("{");
    const properties: Array<Property | SpreadElement> = [];

    const emptyEnd = this.consumePunctuator("}");
    if (emptyEnd !== undefined) {
      return {
        type: "ObjectExpression",
        properties,
        span: createSpan(start.start, emptyEnd.end)
      };
    }

    while (true) {
      if (this.consumePunctuator("...") !== undefined) {
        const spreadStart = this.previousToken();
        const argument = this.parseExpression();
        properties.push({
          type: "SpreadElement",
          argument,
          span: createSpan(spreadStart.start, argument.span.end)
        });
      } else {
        properties.push(this.parseObjectProperty());
      }

      if (this.consumePunctuator(",") !== undefined) {
        if (this.currentToken().type === "punctuator" && this.currentToken().value === "}") {
          break;
        }
        continue;
      }

      break;
    }

    const end = this.expectPunctuator("}");
    return {
      type: "ObjectExpression",
      properties,
      span: createSpan(start.start, end.end)
    };
  }

  private parseObjectProperty(): Property {
    if (this.consumePunctuator("[") !== undefined) {
      const propertyStart = this.previousToken();
      const key = this.parseExpression();
      this.expectPunctuator("]");
      this.expectPunctuator(":");
      const value = this.parseExpression();
      return {
        type: "Property",
        computed: true,
        shorthand: false,
        key,
        value,
        span: createSpan(propertyStart.start, value.span.end)
      };
    }

    const token = this.currentToken();
    if (token.type === "identifier") {
      this.index += 1;
      const key = createIdentifier(token);
      if (this.consumePunctuator(":") === undefined) {
        return {
          type: "Property",
          computed: false,
          shorthand: true,
          key,
          value: createIdentifier(token),
          span: key.span
        };
      }
      const value = this.parseExpression();
      return {
        type: "Property",
        computed: false,
        shorthand: false,
        key,
        value,
        span: createSpan(key.span.start, value.span.end)
      };
    }

    if (isLiteralPropertyKey(token)) {
      this.index += 1;
      const key = createLiteralFromToken(token);
      this.expectPunctuator(":");
      const value = this.parseExpression();
      return {
        type: "Property",
        computed: false,
        shorthand: false,
        key,
        value,
        span: createSpan(key.span.start, value.span.end)
      };
    }

    throw unexpectedTokenError(token);
  }

  private consumePunctuator(value: string): Token | undefined {
    const token = this.currentToken();
    if (token.type !== "punctuator" || token.value !== value) {
      return undefined;
    }
    this.index += 1;
    return token;
  }

  private expectPunctuator(value: string): Token {
    const token = this.currentToken();
    if (token.type !== "punctuator" || token.value !== value) {
      throw new Error(`Expected '${value}' at line ${token.start.line}, column ${token.start.column}.`);
    }
    this.index += 1;
    return token;
  }

  private expectEof(): void {
    const token = this.currentToken();
    if (token.type !== "eof") {
      throw unexpectedTokenError(token);
    }
  }

  private currentToken(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1];
  }

  private previousToken(): Token {
    return this.tokens[this.index - 1] ?? this.tokens[0];
  }
}

function createIdentifier(token: Token): Identifier {
  return {
    type: "Identifier",
    name: token.value,
    span: createTokenSpan(token)
  };
}

function createNumericLiteral(token: Token): NumericLiteral {
  return {
    type: "NumericLiteral",
    raw: token.value,
    value: Number(token.value.replaceAll("_", "")),
    span: createTokenSpan(token)
  };
}

function createStringLiteral(token: Token): StringLiteral {
  return {
    type: "StringLiteral",
    raw: token.value,
    value: decodeEscapedText(token.value.slice(1, -1)),
    span: createTokenSpan(token)
  };
}

function createKeywordLiteral(token: Token): BooleanLiteral | NullLiteral | UndefinedLiteral {
  if (token.value === "true" || token.value === "false") {
    return {
      type: "BooleanLiteral",
      raw: token.value,
      value: token.value === "true",
      span: createTokenSpan(token)
    };
  }

  if (token.value === "null") {
    return {
      type: "NullLiteral",
      raw: "null",
      value: null,
      span: createTokenSpan(token)
    };
  }

  if (token.value === "undefined") {
    return {
      type: "UndefinedLiteral",
      raw: "undefined",
      value: undefined,
      span: createTokenSpan(token)
    };
  }

  throw unexpectedTokenError(token);
}

function createLiteralFromToken(
  token: Token
): BooleanLiteral | NullLiteral | NumericLiteral | StringLiteral | UndefinedLiteral {
  if (token.type === "numeric") {
    return createNumericLiteral(token);
  }

  if (token.type === "string") {
    return createStringLiteral(token);
  }

  return createKeywordLiteral(token);
}

function createTemplateLiteral(token: Token): TemplateLiteral {
  const raw = token.value;
  const expressions: Expression[] = [];
  const quasis: TemplateElement[] = [];
  let cursor = 1;
  let quasiStart = 1;

  while (cursor < raw.length - 1) {
    const char = raw[cursor];

    if (char === "\\") {
      cursor = skipEscapedCharacter(raw, cursor);
      continue;
    }

    if (char === "$" && raw[cursor + 1] === "{") {
      quasis.push(createTemplateElement(token.start, raw, quasiStart, cursor, false));
      const expressionStart = cursor + 2;
      const expressionEnd = findTemplateExpressionEnd(raw, expressionStart);
      const expression = parse(raw.slice(expressionStart, expressionEnd));
      expressions.push(rebaseExpression(expression, token.start, raw, expressionStart));
      quasiStart = expressionEnd + 1;
      cursor = expressionEnd + 1;
      continue;
    }

    cursor += 1;
  }

  quasis.push(createTemplateElement(token.start, raw, quasiStart, raw.length - 1, true));

  return {
    type: "TemplateLiteral",
    expressions,
    quasis,
    span: createTokenSpan(token)
  };
}

function createTemplateElement(
  templateStart: Position,
  rawTemplate: string,
  rawStart: number,
  rawEnd: number,
  tail: boolean
): TemplateElement {
  const rawValue = rawTemplate.slice(rawStart, rawEnd);
  return {
    type: "TemplateElement",
    tail,
    value: {
      raw: rawValue,
      cooked: decodeEscapedText(rawValue)
    },
    span: createSpan(
      positionWithinRaw(templateStart, rawTemplate, rawStart),
      positionWithinRaw(templateStart, rawTemplate, rawEnd)
    )
  };
}

function findTemplateExpressionEnd(raw: string, start: number): number {
  let depth = 1;
  let index = start;

  while (index < raw.length - 1) {
    const char = raw[index];

    if (char === "'" || char === "\"") {
      index = skipQuotedString(raw, index, char);
      continue;
    }

    if (char === "`") {
      index = skipNestedTemplate(raw, index);
      continue;
    }

    if (char === "/" && raw[index + 1] === "/") {
      index = skipLineComment(raw, index);
      continue;
    }

    if (char === "/" && raw[index + 1] === "*") {
      index = skipBlockComment(raw, index);
      continue;
    }

    if (char === "{") {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
      index += 1;
      continue;
    }

    index += 1;
  }

  throw new Error(`Unterminated template literal at line ${1}, column ${raw.length}.`);
}

function skipQuotedString(raw: string, start: number, quote: string): number {
  let index = start + 1;

  while (index < raw.length) {
    const char = raw[index];
    if (char === "\\") {
      index = skipEscapedCharacter(raw, index);
      continue;
    }
    if (char === quote) {
      return index + 1;
    }
    index += 1;
  }

  return index;
}

function skipNestedTemplate(raw: string, start: number): number {
  let index = start + 1;

  while (index < raw.length) {
    const char = raw[index];
    if (char === "\\") {
      index = skipEscapedCharacter(raw, index);
      continue;
    }
    if (char === "`") {
      return index + 1;
    }
    if (char === "$" && raw[index + 1] === "{") {
      index = findTemplateExpressionEnd(raw, index + 2) + 1;
      continue;
    }
    index += 1;
  }

  return index;
}

function skipLineComment(raw: string, start: number): number {
  let index = start + 2;
  while (index < raw.length && raw[index] !== "\n" && raw[index] !== "\r") {
    index += 1;
  }
  return index;
}

function skipBlockComment(raw: string, start: number): number {
  let index = start + 2;
  while (index < raw.length - 1) {
    if (raw[index] === "*" && raw[index + 1] === "/") {
      return index + 2;
    }
    index += 1;
  }
  return raw.length;
}

function skipEscapedCharacter(raw: string, start: number): number {
  const next = raw[start + 1];
  if (next === "\r") {
    if (raw[start + 2] === "\n") {
      return start + 3;
    }
    return start + 2;
  }

  if (next === "\n") {
    return start + 2;
  }

  return Math.min(start + 2, raw.length);
}

function decodeEscapedText(value: string): string {
  let decoded = "";
  let index = 0;

  while (index < value.length) {
    const char = value[index];
    if (char !== "\\") {
      decoded += char;
      index += 1;
      continue;
    }

    const next = value[index + 1];
    if (next === undefined) {
      decoded += "\\";
      break;
    }

    if (next === "\n") {
      index += 2;
      continue;
    }

    if (next === "\r") {
      if (value[index + 2] === "\n") {
        index += 3;
      } else {
        index += 2;
      }
      continue;
    }

    decoded += decodeEscapeCharacter(next);
    index += 2;
  }

  return decoded;
}

function decodeEscapeCharacter(char: string): string {
  if (char === "n") {
    return "\n";
  }
  if (char === "r") {
    return "\r";
  }
  if (char === "t") {
    return "\t";
  }
  if (char === "b") {
    return "\b";
  }
  if (char === "f") {
    return "\f";
  }
  if (char === "v") {
    return "\v";
  }
  if (char === "0") {
    return "\0";
  }
  return char;
}

function positionWithinRaw(base: Position, raw: string, index: number): Position {
  let line = base.line;
  let column = base.column;
  let offset = base.offset;
  let cursor = 0;

  while (cursor < index) {
    const char = raw[cursor];

    if (char === "\r") {
      cursor += 1;
      offset += 1;
      if (raw[cursor] === "\n" && cursor < index) {
        cursor += 1;
        offset += 1;
      }
      line += 1;
      column = 1;
      continue;
    }

    cursor += 1;
    offset += 1;
    if (char === "\n") {
      line += 1;
      column = 1;
      continue;
    }
    column += 1;
  }

  return { line, column, offset };
}

function rebaseExpression(
  expression: Expression,
  templateStart: Position,
  rawTemplate: string,
  rawOffset: number
): Expression {
  expression.span = rebaseSpan(expression.span, templateStart, rawTemplate, rawOffset);

  if (expression.type === "ArrayExpression") {
    expression.elements = expression.elements.map(element => rebaseNode(element, templateStart, rawTemplate, rawOffset));
    return expression;
  }

  if (expression.type === "ObjectExpression") {
    expression.properties = expression.properties.map(property =>
      rebaseNode(property, templateStart, rawTemplate, rawOffset)
    );
    return expression;
  }

  if (expression.type === "TemplateLiteral") {
    expression.expressions = expression.expressions.map(item =>
      rebaseExpression(item, templateStart, rawTemplate, rawOffset)
    );
    expression.quasis = expression.quasis.map(quasi => rebaseTemplateElement(quasi, templateStart, rawTemplate, rawOffset));
    return expression;
  }

  return expression;
}

function rebaseNode<T extends Expression | Property | SpreadElement | TemplateElement>(
  node: T,
  templateStart: Position,
  rawTemplate: string,
  rawOffset: number
): T {
  if (node.type === "SpreadElement") {
    node.argument = rebaseExpression(node.argument, templateStart, rawTemplate, rawOffset);
    node.span = rebaseSpan(node.span, templateStart, rawTemplate, rawOffset);
    return node as T;
  }

  if (node.type === "Property") {
    node.key = rebaseExpression(node.key, templateStart, rawTemplate, rawOffset);
    node.value = rebaseExpression(node.value, templateStart, rawTemplate, rawOffset);
    node.span = rebaseSpan(node.span, templateStart, rawTemplate, rawOffset);
    return node as T;
  }

  if (node.type === "TemplateElement") {
    return rebaseTemplateElement(node, templateStart, rawTemplate, rawOffset) as T;
  }

  return rebaseExpression(node as Expression, templateStart, rawTemplate, rawOffset) as T;
}

function rebaseTemplateElement(
  quasi: TemplateElement,
  templateStart: Position,
  rawTemplate: string,
  rawOffset: number
): TemplateElement {
  quasi.span = rebaseSpan(quasi.span, templateStart, rawTemplate, rawOffset);
  return quasi;
}

function rebaseSpan(
  span: SourceSpan,
  templateStart: Position,
  rawTemplate: string,
  rawOffset: number
): SourceSpan {
  return {
    start: positionWithinRaw(templateStart, rawTemplate, rawOffset + span.start.offset),
    end: positionWithinRaw(templateStart, rawTemplate, rawOffset + span.end.offset)
  };
}

function isLiteralPropertyKey(token: Token): boolean {
  if (token.type === "numeric" || token.type === "string") {
    return true;
  }

  return (
    token.type === "keyword" &&
    (token.value === "true" || token.value === "false" || token.value === "null" || token.value === "undefined")
  );
}

function createTokenSpan(token: Token): SourceSpan {
  return createSpan(token.start, token.end);
}

function createSpan(start: Position, end: Position): SourceSpan {
  return {
    start: { ...start },
    end: { ...end }
  };
}

function unexpectedTokenError(token: Token): Error {
  if (token.type === "eof") {
    return new Error(`Unexpected end of input at line ${token.start.line}, column ${token.start.column}.`);
  }

  return new Error(`Unexpected token '${token.value}' at line ${token.start.line}, column ${token.start.column}.`);
}
