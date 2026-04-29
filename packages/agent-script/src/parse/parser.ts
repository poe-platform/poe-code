import { tokenize, type Position, type Token } from "./tokenizer.js";

export type SourceSpan = {
  start: Position;
  end: Position;
};

export class DisallowedSyntaxError extends Error {
  constructor(syntax: string, position: Position) {
    super(`Disallowed syntax '${syntax}' at line ${position.line}, column ${position.column}.`);
    this.name = "DisallowedSyntaxError";
  }
}

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

export type UnaryOperator = "!" | "+" | "-" | "~";

export type UnaryExpression = BaseNode & {
  type: "UnaryExpression";
  operator: UnaryOperator;
  prefix: true;
  argument: Expression;
};

export type BinaryOperator =
  | "!="
  | "!=="
  | "%"
  | "&"
  | "*"
  | "**"
  | "+"
  | "-"
  | "/"
  | "<"
  | "<<"
  | "<="
  | "=="
  | "==="
  | ">"
  | ">="
  | ">>"
  | ">>>"
  | "in"
  | "^"
  | "|";

export type BinaryExpression = BaseNode & {
  type: "BinaryExpression";
  operator: BinaryOperator;
  left: Expression;
  right: Expression;
};

export type LogicalOperator = "&&" | "??" | "||";

export type LogicalExpression = BaseNode & {
  type: "LogicalExpression";
  operator: LogicalOperator;
  left: Expression;
  right: Expression;
};

export type ConditionalExpression = BaseNode & {
  type: "ConditionalExpression";
  test: Expression;
  consequent: Expression;
  alternate: Expression;
};

export type MemberExpression = BaseNode & {
  type: "MemberExpression";
  computed: boolean;
  object: Expression;
  optional: boolean;
  property: Expression;
};

export type CallExpression = BaseNode & {
  type: "CallExpression";
  arguments: Array<Expression | SpreadElement>;
  callee: Expression;
  optional: boolean;
};

export type Expression =
  | ArrayExpression
  | BinaryExpression
  | BooleanLiteral
  | CallExpression
  | ConditionalExpression
  | Identifier
  | LogicalExpression
  | MemberExpression
  | NullLiteral
  | NumericLiteral
  | ObjectExpression
  | StringLiteral
  | TemplateLiteral
  | UnaryExpression
  | UndefinedLiteral;

type ParsedExpression = {
  node: Expression;
  parenthesized: boolean;
};

const EQUALITY_OPERATORS = new Set<BinaryOperator>(["==", "!=", "===", "!=="]);
const RELATIONAL_OPERATORS = new Set<BinaryOperator>(["<", "<=", ">", ">=", "in"]);
const SHIFT_OPERATORS = new Set<BinaryOperator>(["<<", ">>", ">>>"]);
const ADDITIVE_OPERATORS = new Set<BinaryOperator>(["+", "-"]);
const MULTIPLICATIVE_OPERATORS = new Set<BinaryOperator>(["*", "/", "%"]);
const BITWISE_OR_OPERATORS = new Set<BinaryOperator>(["|"]);
const BITWISE_XOR_OPERATORS = new Set<BinaryOperator>(["^"]);
const BITWISE_AND_OPERATORS = new Set<BinaryOperator>(["&"]);

export function parse(source: string): Expression {
  return parseTokens(tokenize(source));
}

function parseTokens(tokens: Token[]): Expression {
  return new Parser(tokens).parse();
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Expression {
    const expression = this.parseExpression().node;
    while (this.consumePunctuator(";") !== undefined) {
      continue;
    }
    this.expectEof();
    return expression;
  }

  private parseExpression(): ParsedExpression {
    return this.parseConditionalExpression();
  }

  private parseConditionalExpression(): ParsedExpression {
    const test = this.parseCoalesceExpression();
    if (this.consumePunctuator("?") === undefined) {
      return test;
    }

    const consequent = this.parseExpression();
    this.expectPunctuator(":");
    const alternate = this.parseConditionalExpression();
    return {
      node: {
        type: "ConditionalExpression",
        test: test.node,
        consequent: consequent.node,
        alternate: alternate.node,
        span: createSpan(test.node.span.start, alternate.node.span.end)
      },
      parenthesized: false
    };
  }

  private parseCoalesceExpression(): ParsedExpression {
    let left = this.parseLogicalOrExpression();

    while (this.consumePunctuator("??") !== undefined) {
      this.assertNullishOperand(left);
      const right = this.parseLogicalOrExpression();
      this.assertNullishOperand(right);
      left = {
        node: {
          type: "LogicalExpression",
          operator: "??",
          left: left.node,
          right: right.node,
          span: createSpan(left.node.span.start, right.node.span.end)
        },
        parenthesized: false
      };
    }

    return left;
  }

  private parseLogicalOrExpression(): ParsedExpression {
    return this.parseLogicalExpression(
      () => this.parseLogicalAndExpression(),
      "||"
    );
  }

  private parseLogicalAndExpression(): ParsedExpression {
    return this.parseLogicalExpression(
      () => this.parseBitwiseOrExpression(),
      "&&"
    );
  }

  private parseBitwiseOrExpression(): ParsedExpression {
    return this.parseBinaryExpression(
      () => this.parseBitwiseXorExpression(),
      BITWISE_OR_OPERATORS
    );
  }

  private parseBitwiseXorExpression(): ParsedExpression {
    return this.parseBinaryExpression(
      () => this.parseBitwiseAndExpression(),
      BITWISE_XOR_OPERATORS
    );
  }

  private parseBitwiseAndExpression(): ParsedExpression {
    return this.parseBinaryExpression(
      () => this.parseEqualityExpression(),
      BITWISE_AND_OPERATORS
    );
  }

  private parseEqualityExpression(): ParsedExpression {
    return this.parseBinaryExpression(
      () => this.parseRelationalExpression(),
      EQUALITY_OPERATORS
    );
  }

  private parseRelationalExpression(): ParsedExpression {
    return this.parseBinaryExpression(
      () => this.parseShiftExpression(),
      RELATIONAL_OPERATORS
    );
  }

  private parseShiftExpression(): ParsedExpression {
    return this.parseBinaryExpression(
      () => this.parseAdditiveExpression(),
      SHIFT_OPERATORS
    );
  }

  private parseAdditiveExpression(): ParsedExpression {
    return this.parseBinaryExpression(
      () => this.parseMultiplicativeExpression(),
      ADDITIVE_OPERATORS
    );
  }

  private parseMultiplicativeExpression(): ParsedExpression {
    return this.parseBinaryExpression(
      () => this.parseExponentiationExpression(),
      MULTIPLICATIVE_OPERATORS
    );
  }

  private parseExponentiationExpression(): ParsedExpression {
    const left = this.parseUnaryExpression();

    if (this.consumePunctuator("**") === undefined) {
      return left;
    }

    if (!left.parenthesized && left.node.type === "UnaryExpression") {
      const operator = this.previousToken();
      throw new Error(
        `Unary expressions cannot be used as the left-hand side of '**' without parentheses at line ${operator.start.line}, column ${operator.start.column}.`
      );
    }

    const right = this.parseExponentiationExpression();
    return {
      node: {
        type: "BinaryExpression",
        operator: "**",
        left: left.node,
        right: right.node,
        span: createSpan(left.node.span.start, right.node.span.end)
      },
      parenthesized: false
    };
  }

  private parseUnaryExpression(): ParsedExpression {
    const token = this.currentToken();
    if (
      token.type === "punctuator" &&
      (token.value === "!" || token.value === "+" || token.value === "-" || token.value === "~")
    ) {
      this.index += 1;
      const argument = this.parseUnaryExpression();
      return {
        node: {
          type: "UnaryExpression",
          operator: token.value as UnaryOperator,
          prefix: true,
          argument: argument.node,
          span: createSpan(token.start, argument.node.span.end)
        },
        parenthesized: false
      };
    }

    return this.parseLeftHandSideExpression();
  }

  private parseLeftHandSideExpression(): ParsedExpression {
    let expression = this.parsePrimaryExpression();

    while (true) {
      const optionalChain = this.consumePunctuator("?.");
      if (optionalChain !== undefined) {
        if (this.consumePunctuator("(") !== undefined) {
          expression = {
            node: this.createCallExpression(expression.node, true),
            parenthesized: false
          };
          continue;
        }

        if (this.consumePunctuator("[") !== undefined) {
          const property = this.parseExpression();
          const end = this.expectPunctuator("]");
          expression = {
            node: {
              type: "MemberExpression",
              computed: true,
              object: expression.node,
              optional: true,
              property: property.node,
              span: createSpan(expression.node.span.start, end.end)
            },
            parenthesized: false
          };
          continue;
        }

        const property = this.parseIdentifierName();
        expression = {
          node: {
            type: "MemberExpression",
            computed: false,
            object: expression.node,
            optional: true,
            property,
            span: createSpan(expression.node.span.start, property.span.end)
          },
          parenthesized: false
        };
        continue;
      }

      if (this.consumePunctuator(".") !== undefined) {
        const property = this.parseIdentifierName();
        expression = {
          node: {
            type: "MemberExpression",
            computed: false,
            object: expression.node,
            optional: false,
            property,
            span: createSpan(expression.node.span.start, property.span.end)
          },
          parenthesized: false
        };
        continue;
      }

      if (this.consumePunctuator("[") !== undefined) {
        const property = this.parseExpression();
        const end = this.expectPunctuator("]");
        expression = {
          node: {
            type: "MemberExpression",
            computed: true,
            object: expression.node,
            optional: false,
            property: property.node,
            span: createSpan(expression.node.span.start, end.end)
          },
          parenthesized: false
        };
        continue;
      }

      if (this.consumePunctuator("(") !== undefined) {
        expression = {
          node: this.createCallExpression(expression.node, false),
          parenthesized: false
        };
        continue;
      }

      break;
    }

    return expression;
  }

  private parsePrimaryExpression(): ParsedExpression {
    const token = this.currentToken();

    if (token.type === "identifier") {
      assertAllowedIdentifierReference(token);
      this.index += 1;
      return {
        node: createIdentifier(token),
        parenthesized: false
      };
    }

    if (token.type === "numeric") {
      this.index += 1;
      return {
        node: createNumericLiteral(token),
        parenthesized: false
      };
    }

    if (token.type === "string") {
      this.index += 1;
      return {
        node: createStringLiteral(token),
        parenthesized: false
      };
    }

    if (token.type === "template") {
      this.index += 1;
      return {
        node: createTemplateLiteral(token),
        parenthesized: false
      };
    }

    if (token.type === "keyword") {
      this.index += 1;
      return {
        node: createKeywordLiteral(token),
        parenthesized: false
      };
    }

    if (token.type === "punctuator" && token.value === "(") {
      const start = this.expectPunctuator("(");
      const expression = this.parseExpression();
      const end = this.expectPunctuator(")");
      expression.node.span = createSpan(start.start, end.end);
      return {
        node: expression.node,
        parenthesized: true
      };
    }

    if (token.type === "punctuator" && token.value === "[") {
      return {
        node: this.parseArrayExpression(),
        parenthesized: false
      };
    }

    if (token.type === "punctuator" && token.value === "{") {
      return {
        node: this.parseObjectExpression(),
        parenthesized: false
      };
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
          argument: argument.node,
          span: createSpan(spreadStart.start, argument.node.span.end)
        });
      } else {
        elements.push(this.parseExpression().node);
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
          argument: argument.node,
          span: createSpan(spreadStart.start, argument.node.span.end)
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
        key: key.node,
        value: value.node,
        span: createSpan(propertyStart.start, value.node.span.end)
      };
    }

    const token = this.currentToken();
    if (token.type === "identifier") {
      this.index += 1;
      const key = createIdentifier(token);
      if (this.consumePunctuator(":") === undefined) {
        assertAllowedIdentifierReference(token);
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
        value: value.node,
        span: createSpan(key.span.start, value.node.span.end)
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
        value: value.node,
        span: createSpan(key.span.start, value.node.span.end)
      };
    }

    throw unexpectedTokenError(token);
  }

  private parseIdentifierName(): Identifier {
    const token = this.currentToken();
    if (token.type !== "identifier" && token.type !== "keyword") {
      throw unexpectedTokenError(token);
    }
    this.index += 1;
    return createIdentifierName(token);
  }

  private parseArguments(): Array<Expression | SpreadElement> {
    const args: Array<Expression | SpreadElement> = [];

    const emptyEnd = this.consumePunctuator(")");
    if (emptyEnd !== undefined) {
      return args;
    }

    while (true) {
      if (this.currentToken().type === "punctuator" && this.currentToken().value === ",") {
        throw unexpectedTokenError(this.currentToken());
      }

      if (this.consumePunctuator("...") !== undefined) {
        const spreadStart = this.previousToken();
        const argument = this.parseExpression();
        args.push({
          type: "SpreadElement",
          argument: argument.node,
          span: createSpan(spreadStart.start, argument.node.span.end)
        });
      } else {
        args.push(this.parseExpression().node);
      }

      if (this.consumePunctuator(",") !== undefined) {
        if (this.currentToken().type === "punctuator" && this.currentToken().value === ")") {
          break;
        }
        continue;
      }

      break;
    }

    this.expectPunctuator(")");
    return args;
  }

  private createCallExpression(callee: Expression, optional: boolean): CallExpression {
    const args = this.parseArguments();
    const end = this.previousToken();
    return {
      type: "CallExpression",
      arguments: args,
      callee,
      optional,
      span: createSpan(callee.span.start, end.end)
    };
  }

  private parseLogicalExpression(
    parseOperand: () => ParsedExpression,
    operator: Exclude<LogicalOperator, "??">
  ): ParsedExpression {
    let left = parseOperand();

    while (this.consumePunctuator(operator) !== undefined) {
      const right = parseOperand();
      left = {
        node: {
          type: "LogicalExpression",
          operator,
          left: left.node,
          right: right.node,
          span: createSpan(left.node.span.start, right.node.span.end)
        },
        parenthesized: false
      };
    }

    return left;
  }

  private parseBinaryExpression(
    parseOperand: () => ParsedExpression,
    operators: ReadonlySet<BinaryOperator>
  ): ParsedExpression {
    let left = parseOperand();

    while (true) {
      const token = this.currentToken();
      if (!operators.has(token.value as BinaryOperator)) {
        return left;
      }

      this.index += 1;
      const right = parseOperand();
      left = {
        node: {
          type: "BinaryExpression",
          operator: token.value as BinaryOperator,
          left: left.node,
          right: right.node,
          span: createSpan(left.node.span.start, right.node.span.end)
        },
        parenthesized: false
      };
    }
  }

  private assertNullishOperand(expression: ParsedExpression): void {
    if (
      !expression.parenthesized &&
      expression.node.type === "LogicalExpression" &&
      (expression.node.operator === "&&" || expression.node.operator === "||")
    ) {
      throw new Error(
        `Cannot mix '??' with '&&' or '||' without parentheses at line ${expression.node.right.span.start.line}, column ${expression.node.right.span.start.column}.`
      );
    }
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

function createIdentifierName(token: Token): Identifier {
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
      expressions.push(
        parseEmbeddedExpression(
          raw.slice(expressionStart, expressionEnd),
          positionWithinRaw(token.start, raw, expressionStart)
        )
      );
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

function parseEmbeddedExpression(source: string, base: Position): Expression {
  const tokens = tokenize(source).map(token => ({
    ...token,
    start: rebasePosition(token.start, base),
    end: rebasePosition(token.end, base)
  }));
  return parseTokens(tokens);
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

function rebasePosition(position: Position, base: Position): Position {
  return {
    line: base.line + position.line - 1,
    column: position.line === 1 ? base.column + position.column - 1 : position.column,
    offset: base.offset + position.offset
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

function assertAllowedIdentifierReference(token: Token): void {
  if (token.value === "new" || token.value === "this") {
    throw new DisallowedSyntaxError(token.value, token.start);
  }
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
