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

export type PatternTarget = ArrayPattern | Identifier | MemberExpression | ObjectPattern;

export type AssignmentPattern = BaseNode & {
  type: "AssignmentPattern";
  left: PatternTarget;
  right: Expression;
};

export type RestElement = BaseNode & {
  type: "RestElement";
  argument: PatternTarget;
};

export type AssignmentProperty = BaseNode & {
  type: "AssignmentProperty";
  computed: boolean;
  shorthand: boolean;
  key: Expression;
  value: AssignmentPattern | ArrayPattern | Identifier | MemberExpression | ObjectPattern;
};

export type ArrayPattern = BaseNode & {
  type: "ArrayPattern";
  elements: Array<AssignmentPattern | ArrayPattern | Identifier | MemberExpression | ObjectPattern | RestElement | null>;
};

export type ObjectPattern = BaseNode & {
  type: "ObjectPattern";
  properties: Array<AssignmentProperty | RestElement>;
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

export type AssignmentExpression = BaseNode & {
  type: "AssignmentExpression";
  operator: "=";
  left: PatternTarget;
  right: Expression;
};

export type CallExpression = BaseNode & {
  type: "CallExpression";
  arguments: Array<Expression | SpreadElement>;
  callee: Expression;
  optional: boolean;
};

export type VariableDeclarator = BaseNode & {
  type: "VariableDeclarator";
  id: ArrayPattern | Identifier | ObjectPattern;
  init?: Expression;
};

export type VariableDeclarationKind = "const" | "let";

export type VariableDeclaration = BaseNode & {
  type: "VariableDeclaration";
  declarations: VariableDeclarator[];
  kind: VariableDeclarationKind;
};

export type ReturnStatement = BaseNode & {
  type: "ReturnStatement";
  argument?: Expression;
};

export type BreakStatement = BaseNode & {
  type: "BreakStatement";
};

export type ContinueStatement = BaseNode & {
  type: "ContinueStatement";
};

export type ExpressionStatement = BaseNode & {
  type: "ExpressionStatement";
  expression: Expression;
};

export type BlockStatement = BaseNode & {
  type: "BlockStatement";
  body: Statement[];
};

export type IfStatement = BaseNode & {
  type: "IfStatement";
  test: Expression;
  consequent: Statement;
  alternate?: Statement;
};

export type ForStatement = BaseNode & {
  type: "ForStatement";
  init?: Expression | VariableDeclaration;
  test?: Expression;
  update?: Expression;
  body: Statement;
};

export type ForOfStatement = BaseNode & {
  type: "ForOfStatement";
  left: PatternTarget | VariableDeclaration;
  right: Expression;
  body: Statement;
};

export type WhileStatement = BaseNode & {
  type: "WhileStatement";
  test: Expression;
  body: Statement;
};

export type Statement =
  | BlockStatement
  | BreakStatement
  | ContinueStatement
  | ExpressionStatement
  | ForOfStatement
  | ForStatement
  | IfStatement
  | ReturnStatement
  | VariableDeclaration
  | WhileStatement;

export type ArrowFunctionExpression = BaseNode & {
  type: "ArrowFunctionExpression";
  async: boolean;
  body: BlockStatement | Expression;
  expression: boolean;
  params: Array<AssignmentPattern | ArrayPattern | Identifier | ObjectPattern | RestElement>;
};

export type Expression =
  | ArrowFunctionExpression
  | AssignmentExpression
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

export type ParseResult = Expression | Statement;

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
const TOP_LEVEL_STATEMENT_KEYWORDS = new Set(["break", "const", "continue", "for", "if", "let", "return", "while"]);

export function parse(source: string): ParseResult {
  return parseTokens(tokenize(source));
}

function parseTokens(tokens: Token[]): ParseResult {
  return new Parser(tokens).parseTopLevel();
}

function parseExpressionTokens(tokens: Token[]): Expression {
  return new Parser(tokens).parseExpressionOnly();
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parseTopLevel(): ParseResult {
    const node = this.shouldParseTopLevelStatement() ? this.parseStatement() : this.parseExpression().node;
    while (this.consumePunctuator(";") !== undefined) {
      continue;
    }
    this.expectEof();
    return node;
  }

  parseExpressionOnly(): Expression {
    const expression = this.parseExpression().node;
    while (this.consumePunctuator(";") !== undefined) {
      continue;
    }
    this.expectEof();
    return expression;
  }

  private parseExpression(): ParsedExpression {
    const arrowFunction = this.tryParseArrowFunctionExpression();
    if (arrowFunction !== undefined) {
      return {
        node: arrowFunction,
        parenthesized: false
      };
    }

    return this.parseAssignmentExpression();
  }

  private parseAssignmentExpression(): ParsedExpression {
    const patternAssignment = this.tryParsePatternAssignmentExpression();
    if (patternAssignment !== undefined) {
      return {
        node: patternAssignment,
        parenthesized: false
      };
    }

    const left = this.parseConditionalExpression();
    if (this.consumePunctuator("=") === undefined) {
      return left;
    }

    const right = this.parseAssignmentExpression();
    return {
      node: {
        type: "AssignmentExpression",
        operator: "=",
        left: this.toAssignmentTarget(left.node),
        right: right.node,
        span: createSpan(left.node.span.start, right.node.span.end)
      },
      parenthesized: false
    };
  }

  private tryParseArrowFunctionExpression(): ArrowFunctionExpression | undefined {
    if (this.isAsyncArrowWithParenthesizedParams()) {
      const asyncToken = this.currentToken();
      this.index += 1;
      const params = this.parseArrowParameters();
      return this.finishArrowFunctionExpression(asyncToken.start, true, params);
    }

    if (this.isAsyncArrowWithSingleParam()) {
      const asyncToken = this.currentToken();
      this.index += 1;
      const param = this.parseBindingIdentifier();
      return this.finishArrowFunctionExpression(asyncToken.start, true, [param]);
    }

    if (this.isParenthesizedArrowFunction()) {
      const start = this.currentToken().start;
      const params = this.parseArrowParameters();
      return this.finishArrowFunctionExpression(start, false, params);
    }

    if (this.isSingleParamArrowFunction()) {
      const param = this.parseBindingIdentifier();
      return this.finishArrowFunctionExpression(param.span.start, false, [param]);
    }

    return undefined;
  }

  private finishArrowFunctionExpression(
    start: Position,
    isAsync: boolean,
    params: ArrowFunctionExpression["params"]
  ): ArrowFunctionExpression {
    this.expectPunctuator("=>");
    const body = this.parseArrowFunctionBody();
    return {
      type: "ArrowFunctionExpression",
      async: isAsync,
      body,
      expression: body.type !== "BlockStatement",
      params,
      span: createSpan(start, body.span.end)
    };
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

  private parseArrowFunctionBody(): BlockStatement | Expression {
    if (this.currentToken().type === "punctuator" && this.currentToken().value === "{") {
      return this.parseBlockStatement();
    }

    return this.parseExpression().node;
  }

  private parseBlockStatement(): BlockStatement {
    const start = this.expectPunctuator("{");
    const body: Statement[] = [];

    while (this.consumePunctuator("}") === undefined) {
      body.push(this.parseStatement());
      while (this.consumePunctuator(";") !== undefined) {
        continue;
      }
    }

    return {
      type: "BlockStatement",
      body,
      span: createSpan(start.start, this.previousToken().end)
    };
  }

  private parseStatement(): Statement {
    const token = this.currentToken();
    this.assertAllowedStatementStart(token);

    if (token.type === "punctuator" && token.value === "{") {
      return this.parseBlockStatement();
    }

    if (token.type === "keyword" && token.value === "if") {
      return this.parseIfStatement();
    }

    if (token.type === "keyword" && token.value === "for") {
      return this.parseForStatement();
    }

    if (token.type === "keyword" && token.value === "while") {
      return this.parseWhileStatement();
    }

    if (token.type === "keyword" && token.value === "return") {
      this.index += 1;
      const hasArgument = !(
        hasLineBreakBetween(token, this.currentToken()) ||
        this.currentToken().type === "punctuator" &&
        (this.currentToken().value === ";" || this.currentToken().value === "}") ||
        this.currentToken().type === "eof"
      );
      const argument = hasArgument ? this.parseExpression().node : undefined;
      const end = argument?.span.end ?? token.end;
      return {
        type: "ReturnStatement",
        argument,
        span: createSpan(token.start, end)
      };
    }

    if (token.type === "keyword" && (token.value === "const" || token.value === "let")) {
      return this.parseVariableDeclaration();
    }

    if (token.type === "keyword" && token.value === "break") {
      this.index += 1;
      this.assertNoLabel(token);
      return {
        type: "BreakStatement",
        span: createSpan(token.start, token.end)
      };
    }

    if (token.type === "keyword" && token.value === "continue") {
      this.index += 1;
      this.assertNoLabel(token);
      return {
        type: "ContinueStatement",
        span: createSpan(token.start, token.end)
      };
    }

    const expression = this.parseExpression().node;
    return {
      type: "ExpressionStatement",
      expression,
      span: createSpan(expression.span.start, expression.span.end)
    };
  }

  private parseIfStatement(): IfStatement {
    const ifToken = this.expectKeyword("if");
    this.expectPunctuator("(");
    const test = this.parseExpression().node;
    this.expectPunctuator(")");
    const consequent = this.parseStatement();
    if (consequent.type !== "BlockStatement") {
      while (
        this.currentToken().type === "punctuator" &&
        this.currentToken().value === ";" &&
        this.peekToken(1).type === "keyword" &&
        this.peekToken(1).value === "else"
      ) {
        this.index += 1;
      }
    }
    const elseToken = this.consumeKeyword("else");
    const alternate = elseToken === undefined ? undefined : this.parseStatement();
    return {
      type: "IfStatement",
      test,
      consequent,
      alternate,
      span: createSpan(ifToken.start, alternate?.span.end ?? consequent.span.end)
    };
  }

  private parseForStatement(): ForOfStatement | ForStatement {
    const forToken = this.expectKeyword("for");
    this.expectPunctuator("(");
    if (this.currentToken().type === "identifier" && this.currentToken().value === "var") {
      throw new DisallowedSyntaxError("var", this.currentToken().start);
    }
    const iterationOperator = this.findTopLevelForIterationOperator(this.index);

    if (iterationOperator?.value === "in") {
      throw new DisallowedSyntaxError("for...in", iterationOperator.start);
    }

    if (iterationOperator?.value === "of") {
      const left = this.parseForOfLeft();
      this.expectKeyword("of");
      const right = this.parseExpression().node;
      this.expectPunctuator(")");
      const body = this.parseStatement();
      return {
        type: "ForOfStatement",
        left,
        right,
        body,
        span: createSpan(forToken.start, body.span.end)
      };
    }

    let init: Expression | VariableDeclaration | undefined;
    if (this.consumePunctuator(";") === undefined) {
      init =
        this.currentToken().type === "keyword" &&
        (this.currentToken().value === "const" || this.currentToken().value === "let")
          ? this.parseVariableDeclaration()
          : this.parseExpression().node;
      this.expectPunctuator(";");
    }

    let test: Expression | undefined;
    if (this.consumePunctuator(";") === undefined) {
      test = this.parseExpression().node;
      this.expectPunctuator(";");
    }

    const update =
      this.currentToken().type === "punctuator" && this.currentToken().value === ")" ? undefined : this.parseExpression().node;

    this.expectPunctuator(")");
    const body = this.parseStatement();
    return {
      type: "ForStatement",
      init,
      test,
      update,
      body,
      span: createSpan(forToken.start, body.span.end)
    };
  }

  private parseForOfLeft(): PatternTarget | VariableDeclaration {
    if (
      this.currentToken().type === "keyword" &&
      (this.currentToken().value === "const" || this.currentToken().value === "let")
    ) {
      return this.parseForOfDeclaration();
    }

    return this.parseAssignmentTarget();
  }

  private parseForOfDeclaration(): VariableDeclaration {
    const kindToken = this.currentToken();
    if (kindToken.type !== "keyword" || (kindToken.value !== "const" && kindToken.value !== "let")) {
      throw unexpectedTokenError(kindToken);
    }

    this.index += 1;
    const id = this.parseBindingTarget();
    if (this.currentToken().type === "punctuator" && this.currentToken().value === "=") {
      throw new Error(
        `for...of declarations cannot include an initializer at line ${kindToken.start.line}, column ${kindToken.start.column}.`
      );
    }
    if (this.currentToken().type === "punctuator" && this.currentToken().value === ",") {
      throw new Error(
        `for...of declarations must include exactly one declarator at line ${kindToken.start.line}, column ${kindToken.start.column}.`
      );
    }

    const declarator: VariableDeclarator = {
      type: "VariableDeclarator",
      id,
      span: id.span
    };

    return {
      type: "VariableDeclaration",
      declarations: [declarator],
      kind: kindToken.value,
      span: createSpan(kindToken.start, id.span.end)
    };
  }

  private parseWhileStatement(): WhileStatement {
    const whileToken = this.expectKeyword("while");
    this.expectPunctuator("(");
    const test = this.parseExpression().node;
    this.expectPunctuator(")");
    const body = this.parseStatement();
    return {
      type: "WhileStatement",
      test,
      body,
      span: createSpan(whileToken.start, body.span.end)
    };
  }

  private parseVariableDeclaration(): VariableDeclaration {
    const kindToken = this.currentToken();
    if (kindToken.type !== "keyword" || (kindToken.value !== "const" && kindToken.value !== "let")) {
      throw unexpectedTokenError(kindToken);
    }

    this.index += 1;
    const declarations: VariableDeclaration["declarations"] = [];

    while (true) {
      declarations.push(this.parseVariableDeclarator(kindToken.value));
      if (this.consumePunctuator(",") === undefined) {
        break;
      }
    }

    return {
      type: "VariableDeclaration",
      declarations,
      kind: kindToken.value,
      span: createSpan(kindToken.start, declarations[declarations.length - 1]!.span.end)
    };
  }

  private parseVariableDeclarator(kind: VariableDeclarationKind): VariableDeclarator {
    const id = this.parseBindingTarget();
    let init: Expression | undefined;

    if (this.consumePunctuator("=") !== undefined) {
      init = this.parseExpression().node;
    }

    if (kind === "const" && init === undefined) {
      throw new Error(
        `Missing initializer in const declaration at line ${id.span.start.line}, column ${id.span.start.column}.`
      );
    }

    if (init === undefined && id.type !== "Identifier") {
      throw new Error(
        `Destructuring declarations require an initializer at line ${id.span.start.line}, column ${id.span.start.column}.`
      );
    }

    return {
      type: "VariableDeclarator",
      id,
      init,
      span: createSpan(id.span.start, init?.span.end ?? id.span.end)
    };
  }

  private parseArrowParameters(): ArrowFunctionExpression["params"] {
    this.expectPunctuator("(");
    const params: ArrowFunctionExpression["params"] = [];

    if (this.consumePunctuator(")") !== undefined) {
      return params;
    }

    while (true) {
      const param = this.parseBindingElement();
      params.push(param);

      const comma = this.consumePunctuator(",");
      if (comma === undefined) {
        break;
      }

      if (param.type === "RestElement") {
        if (this.currentToken().type === "punctuator" && this.currentToken().value === ")") {
          throw unexpectedTokenError(comma);
        }
        throw new Error(
          `Rest element must be the last parameter at line ${comma.start.line}, column ${comma.start.column}.`
        );
      }

      if (this.currentToken().type === "punctuator" && this.currentToken().value === ")") {
        break;
      }
    }

    this.expectPunctuator(")");
    return params;
  }

  private parseBindingElement():
    | AssignmentPattern
    | ArrayPattern
    | Identifier
    | ObjectPattern
    | RestElement {
    if (this.consumePunctuator("...") !== undefined) {
      const start = this.previousToken().start;
      const argument = this.parseBindingTarget();
      return {
        type: "RestElement",
        argument,
        span: createSpan(start, argument.span.end)
      };
    }

    const left = this.parseBindingTarget();
    if (this.consumePunctuator("=") === undefined) {
      return left;
    }

    const right = this.parseExpression().node;
    return {
      type: "AssignmentPattern",
      left,
      right,
      span: createSpan(left.span.start, right.span.end)
    };
  }

  private parseBindingTarget(): ArrayPattern | Identifier | ObjectPattern {
    const token = this.currentToken();

    if (token.type === "identifier") {
      return this.parseBindingIdentifier();
    }

    if (token.type === "punctuator" && token.value === "[") {
      return this.parseArrayPattern();
    }

    if (token.type === "punctuator" && token.value === "{") {
      return this.parseObjectPattern();
    }

    throw unexpectedTokenError(token);
  }

  private parseBindingIdentifier(): Identifier {
    const token = this.currentToken();
    if (token.type !== "identifier") {
      throw unexpectedTokenError(token);
    }

    this.index += 1;
    return createIdentifier(token);
  }

  private parseArrayPattern(): ArrayPattern {
    const start = this.expectPunctuator("[");
    const elements: ArrayPattern["elements"] = [];

    if (this.consumePunctuator("]") !== undefined) {
      return {
        type: "ArrayPattern",
        elements,
        span: createSpan(start.start, this.previousToken().end)
      };
    }

    while (true) {
      if (this.currentToken().type === "punctuator" && this.currentToken().value === ",") {
        this.index += 1;
        elements.push(null);
        if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
          break;
        }
        continue;
      }

      const element = this.parseBindingElement();
      elements.push(element);

      const comma = this.consumePunctuator(",");
      if (comma === undefined) {
        break;
      }

      if (element.type === "RestElement") {
        if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
          throw unexpectedTokenError(comma);
        }
        throw new Error(
          `Rest element must be the last element in an array pattern at line ${comma.start.line}, column ${comma.start.column}.`
        );
      }

      if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
        break;
      }
    }

    const end = this.expectPunctuator("]");
    return {
      type: "ArrayPattern",
      elements,
      span: createSpan(start.start, end.end)
    };
  }

  private parseObjectPattern(): ObjectPattern {
    const start = this.expectPunctuator("{");
    const properties: ObjectPattern["properties"] = [];

    if (this.consumePunctuator("}") !== undefined) {
      return {
        type: "ObjectPattern",
        properties,
        span: createSpan(start.start, this.previousToken().end)
      };
    }

    while (true) {
      const property = this.parseObjectPatternProperty();
      properties.push(property);

      const comma = this.consumePunctuator(",");
      if (comma === undefined) {
        break;
      }

      if (property.type === "RestElement") {
        if (this.currentToken().type === "punctuator" && this.currentToken().value === "}") {
          throw unexpectedTokenError(comma);
        }
        throw new Error(
          `Rest element must be the last property in an object pattern at line ${comma.start.line}, column ${comma.start.column}.`
        );
      }

      if (this.currentToken().type === "punctuator" && this.currentToken().value === "}") {
        break;
      }
    }

    const end = this.expectPunctuator("}");
    return {
      type: "ObjectPattern",
      properties,
      span: createSpan(start.start, end.end)
    };
  }

  private parseObjectPatternProperty(): AssignmentProperty | RestElement {
    if (this.consumePunctuator("...") !== undefined) {
      const start = this.previousToken().start;
      const token = this.currentToken();
      if (token.type !== "identifier") {
        throw new Error(
          `Object rest element must bind to an identifier at line ${token.start.line}, column ${token.start.column}.`
        );
      }
      const argument = this.parseBindingIdentifier();
      return {
        type: "RestElement",
        argument,
        span: createSpan(start, argument.span.end)
      };
    }

    if (this.consumePunctuator("[") !== undefined) {
      const start = this.previousToken().start;
      const key = this.parsePatternComputedKey();
      this.expectPunctuator(":");
      const value = this.parseBindingElement();
      if (value.type === "RestElement") {
        throw unexpectedTokenError(this.previousToken());
      }
      return {
        type: "AssignmentProperty",
        computed: true,
        shorthand: false,
        key,
        value,
        span: createSpan(start, value.span.end)
      };
    }

    const token = this.currentToken();
    if (token.type === "identifier") {
      this.index += 1;
      const key = createIdentifier(token);
      if (this.consumePunctuator(":") !== undefined) {
        const value = this.parseBindingElement();
        if (value.type === "RestElement") {
          throw unexpectedTokenError(this.previousToken());
        }
        return {
          type: "AssignmentProperty",
          computed: false,
          shorthand: false,
          key,
          value,
          span: createSpan(key.span.start, value.span.end)
        };
      }

      let value: AssignmentPattern | ArrayPattern | Identifier | ObjectPattern = key;
      if (this.consumePunctuator("=") !== undefined) {
        const right = this.parseExpression().node;
        value = {
          type: "AssignmentPattern",
          left: createIdentifier(token),
          right,
          span: createSpan(key.span.start, right.span.end)
        };
      }
      return {
        type: "AssignmentProperty",
        computed: false,
        shorthand: true,
        key,
        value,
        span: createSpan(key.span.start, value.span.end)
      };
    }

    if (isLiteralPropertyKey(token)) {
      this.index += 1;
      const key = createLiteralFromToken(token);
      this.expectPunctuator(":");
      const value = this.parseBindingElement();
      if (value.type === "RestElement") {
        throw unexpectedTokenError(this.previousToken());
      }
      return {
        type: "AssignmentProperty",
        computed: false,
        shorthand: false,
        key,
        value,
        span: createSpan(key.span.start, value.span.end)
      };
    }

    throw unexpectedTokenError(token);
  }

  private tryParsePatternAssignmentExpression(): AssignmentExpression | undefined {
    const token = this.currentToken();
    if (
      token.type !== "punctuator" ||
      (token.value !== "[" && token.value !== "{") ||
      !this.isPatternAssignmentStart(this.index)
    ) {
      return undefined;
    }

    const left = token.value === "[" ? this.parseAssignmentArrayPattern() : this.parseAssignmentObjectPattern();
    this.expectPunctuator("=");
    const right = this.parseAssignmentExpression().node;
    return {
      type: "AssignmentExpression",
      operator: "=",
      left,
      right,
      span: createSpan(left.span.start, right.span.end)
    };
  }

  private parseAssignmentPatternElement():
    | AssignmentPattern
    | ArrayPattern
    | Identifier
    | MemberExpression
    | ObjectPattern
    | RestElement {
    if (this.consumePunctuator("...") !== undefined) {
      const start = this.previousToken().start;
      const argument = this.parseAssignmentTarget();
      return {
        type: "RestElement",
        argument,
        span: createSpan(start, argument.span.end)
      };
    }

    const left = this.parseAssignmentTarget();
    if (this.consumePunctuator("=") === undefined) {
      return left;
    }

    const right = this.parseAssignmentExpression().node;
    return {
      type: "AssignmentPattern",
      left,
      right,
      span: createSpan(left.span.start, right.span.end)
    };
  }

  private parseAssignmentTarget(): PatternTarget {
    const token = this.currentToken();

    if (token.type === "punctuator" && token.value === "[") {
      return this.parseAssignmentArrayPattern();
    }

    if (token.type === "punctuator" && token.value === "{") {
      return this.parseAssignmentObjectPattern();
    }

    const expression = this.parseLeftHandSideExpression().node;
    if (expression.type === "Identifier") {
      return expression;
    }

    if (expression.type === "MemberExpression" && !expression.optional) {
      return expression;
    }

    throw invalidAssignmentTargetError(expression.span.start);
  }

  private parseAssignmentArrayPattern(): ArrayPattern {
    const start = this.expectPunctuator("[");
    const elements: ArrayPattern["elements"] = [];

    if (this.consumePunctuator("]") !== undefined) {
      return {
        type: "ArrayPattern",
        elements,
        span: createSpan(start.start, this.previousToken().end)
      };
    }

    while (true) {
      if (this.currentToken().type === "punctuator" && this.currentToken().value === ",") {
        this.index += 1;
        elements.push(null);
        if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
          break;
        }
        continue;
      }

      const element = this.parseAssignmentPatternElement();
      elements.push(element);

      const comma = this.consumePunctuator(",");
      if (comma === undefined) {
        break;
      }

      if (element.type === "RestElement") {
        if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
          throw unexpectedTokenError(comma);
        }
        throw new Error(
          `Rest element must be the last element in an array pattern at line ${comma.start.line}, column ${comma.start.column}.`
        );
      }

      if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
        break;
      }
    }

    const end = this.expectPunctuator("]");
    return {
      type: "ArrayPattern",
      elements,
      span: createSpan(start.start, end.end)
    };
  }

  private parseAssignmentObjectPattern(): ObjectPattern {
    const start = this.expectPunctuator("{");
    const properties: ObjectPattern["properties"] = [];

    if (this.consumePunctuator("}") !== undefined) {
      return {
        type: "ObjectPattern",
        properties,
        span: createSpan(start.start, this.previousToken().end)
      };
    }

    while (true) {
      const property = this.parseAssignmentObjectPatternProperty();
      properties.push(property);

      const comma = this.consumePunctuator(",");
      if (comma === undefined) {
        break;
      }

      if (property.type === "RestElement") {
        if (this.currentToken().type === "punctuator" && this.currentToken().value === "}") {
          throw unexpectedTokenError(comma);
        }
        throw new Error(
          `Rest element must be the last property in an object pattern at line ${comma.start.line}, column ${comma.start.column}.`
        );
      }

      if (this.currentToken().type === "punctuator" && this.currentToken().value === "}") {
        break;
      }
    }

    const end = this.expectPunctuator("}");
    return {
      type: "ObjectPattern",
      properties,
      span: createSpan(start.start, end.end)
    };
  }

  private parseAssignmentObjectPatternProperty(): AssignmentProperty | RestElement {
    if (this.consumePunctuator("...") !== undefined) {
      const start = this.previousToken().start;
      const token = this.currentToken();
      if (token.type !== "identifier") {
        throw new Error(
          `Object rest element must bind to an identifier at line ${token.start.line}, column ${token.start.column}.`
        );
      }
      const argument = this.parseBindingIdentifier();
      return {
        type: "RestElement",
        argument,
        span: createSpan(start, argument.span.end)
      };
    }

    if (this.consumePunctuator("[") !== undefined) {
      const start = this.previousToken().start;
      const key = this.parsePatternComputedKey();
      this.expectPunctuator(":");
      const value = this.parseAssignmentPatternElement();
      if (value.type === "RestElement") {
        throw unexpectedTokenError(this.previousToken());
      }
      return {
        type: "AssignmentProperty",
        computed: true,
        shorthand: false,
        key,
        value,
        span: createSpan(start, value.span.end)
      };
    }

    const token = this.currentToken();
    if (token.type === "identifier") {
      this.index += 1;
      const key = createIdentifier(token);
      if (this.consumePunctuator(":") !== undefined) {
        const value = this.parseAssignmentPatternElement();
        if (value.type === "RestElement") {
          throw unexpectedTokenError(this.previousToken());
        }
        return {
          type: "AssignmentProperty",
          computed: false,
          shorthand: false,
          key,
          value,
          span: createSpan(key.span.start, value.span.end)
        };
      }

      let value: AssignmentPattern | ArrayPattern | Identifier | MemberExpression | ObjectPattern = key;
      if (this.consumePunctuator("=") !== undefined) {
        const right = this.parseAssignmentExpression().node;
        value = {
          type: "AssignmentPattern",
          left: createIdentifier(token),
          right,
          span: createSpan(key.span.start, right.span.end)
        };
      }
      return {
        type: "AssignmentProperty",
        computed: false,
        shorthand: true,
        key,
        value,
        span: createSpan(key.span.start, value.span.end)
      };
    }

    if (isLiteralPropertyKey(token)) {
      this.index += 1;
      const key = createLiteralFromToken(token);
      this.expectPunctuator(":");
      const value = this.parseAssignmentPatternElement();
      if (value.type === "RestElement") {
        throw unexpectedTokenError(this.previousToken());
      }
      return {
        type: "AssignmentProperty",
        computed: false,
        shorthand: false,
        key,
        value,
        span: createSpan(key.span.start, value.span.end)
      };
    }

    throw unexpectedTokenError(token);
  }

  private parsePatternComputedKey(): Identifier {
    const key = this.parseExpression().node;
    this.expectPunctuator("]");

    if (key.type !== "Identifier") {
      throw new Error(
        `Computed property names in patterns must use an identifier at line ${key.span.start.line}, column ${key.span.start.column}.`
      );
    }

    return key;
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

  private toAssignmentTarget(node: Expression): PatternTarget {
    if (node.type === "Identifier") {
      return node;
    }

    if (node.type === "MemberExpression" && !node.optional) {
      return node;
    }

    if (node.type === "ArrayExpression") {
      return this.arrayExpressionToPattern(node);
    }

    if (node.type === "ObjectExpression") {
      return this.objectExpressionToPattern(node);
    }

    throw invalidAssignmentTargetError(node.span.start);
  }

  private arrayExpressionToPattern(node: ArrayExpression): ArrayPattern {
    return {
      type: "ArrayPattern",
      elements: node.elements.map(element => this.toArrayPatternElement(element)),
      span: node.span
    };
  }

  private toArrayPatternElement(
    element: Expression | SpreadElement
  ): AssignmentPattern | ArrayPattern | Identifier | MemberExpression | ObjectPattern | RestElement {
    if (element.type === "SpreadElement") {
      const argument = this.toAssignmentTarget(element.argument);
      return {
        type: "RestElement",
        argument,
        span: element.span
      };
    }

    if (element.type === "AssignmentExpression" && element.operator === "=") {
      return {
        type: "AssignmentPattern",
        left: element.left,
        right: element.right,
        span: element.span
      };
    }

    return this.toAssignmentTarget(element);
  }

  private objectExpressionToPattern(node: ObjectExpression): ObjectPattern {
    return {
      type: "ObjectPattern",
      properties: node.properties.map(property => this.toObjectPatternProperty(property)),
      span: node.span
    };
  }

  private toObjectPatternProperty(property: Property | SpreadElement): AssignmentProperty | RestElement {
    if (property.type === "SpreadElement") {
      if (property.argument.type !== "Identifier") {
        throw new Error(
          `Object rest element must bind to an identifier at line ${property.argument.span.start.line}, column ${property.argument.span.start.column}.`
        );
      }

      return {
        type: "RestElement",
        argument: property.argument,
        span: property.span
      };
    }

    if (property.computed && property.key.type !== "Identifier") {
      throw new Error(
        `Computed property names in patterns must use an identifier at line ${property.key.span.start.line}, column ${property.key.span.start.column}.`
      );
    }

    const value =
      property.shorthand && property.value.type === "Identifier"
        ? property.value
        : this.toObjectPropertyValue(property.value);

    return {
      type: "AssignmentProperty",
      computed: property.computed,
      shorthand: property.shorthand,
      key: property.key,
      value,
      span: property.span
    };
  }

  private toObjectPropertyValue(
    value: Expression
  ): AssignmentPattern | ArrayPattern | Identifier | MemberExpression | ObjectPattern {
    if (value.type === "AssignmentExpression" && value.operator === "=") {
      return {
        type: "AssignmentPattern",
        left: value.left,
        right: value.right,
        span: value.span
      };
    }

    return this.toAssignmentTarget(value);
  }

  private isPatternAssignmentStart(startIndex: number): boolean {
    const startToken = this.tokens[startIndex];
    if (startToken?.type !== "punctuator" || (startToken.value !== "[" && startToken.value !== "{")) {
      return false;
    }

    const stack: string[] = [];
    for (let index = startIndex; index < this.tokens.length; index += 1) {
      const token = this.tokens[index];
      if (token.type !== "punctuator") {
        continue;
      }

      if (token.value === "(" || token.value === "[" || token.value === "{") {
        stack.push(token.value);
        continue;
      }

      if (token.value === ")" || token.value === "]" || token.value === "}") {
        const expected = matchingOpeningPunctuator(token.value);
        if (stack[stack.length - 1] === expected) {
          stack.pop();
        }

        if (stack.length === 0) {
          return this.tokens[index + 1]?.type === "punctuator" && this.tokens[index + 1]?.value === "=";
        }
      }
    }

    return false;
  }

  private isSingleParamArrowFunction(): boolean {
    const token = this.currentToken();
    if (token.type !== "identifier" || this.peekToken(1).value !== "=>") {
      return false;
    }

    const arrowToken = this.peekToken(1);
    if (hasLineBreakBetween(token, arrowToken)) {
      throw new Error(
        `Unexpected line break before '=>' at line ${arrowToken.start.line}, column ${arrowToken.start.column}.`
      );
    }

    return true;
  }

  private isAsyncArrowWithSingleParam(): boolean {
    const token = this.currentToken();
    if (
      token.type !== "keyword" ||
      token.value !== "async" ||
      this.peekToken(1).type !== "identifier" ||
      this.peekToken(2).value !== "=>"
    ) {
      return false;
    }

    const paramToken = this.peekToken(1);
    if (hasLineBreakBetween(token, paramToken)) {
      throw new Error(
        `Unexpected line break after 'async' at line ${paramToken.start.line}, column ${paramToken.start.column}.`
      );
    }

    const arrowToken = this.peekToken(2);
    if (hasLineBreakBetween(paramToken, arrowToken)) {
      throw new Error(
        `Unexpected line break before '=>' at line ${arrowToken.start.line}, column ${arrowToken.start.column}.`
      );
    }

    return true;
  }

  private isParenthesizedArrowFunction(): boolean {
    return this.findArrowFromParenthesizedParams(this.index) !== undefined;
  }

  private isAsyncArrowWithParenthesizedParams(): boolean {
    const token = this.currentToken();
    if (token.type !== "keyword" || token.value !== "async") {
      return false;
    }

    const nextToken = this.peekToken(1);
    const arrowIndex = this.findArrowFromParenthesizedParams(this.index + 1);
    if (arrowIndex === undefined) {
      return false;
    }

    if (hasLineBreakBetween(token, nextToken)) {
      throw new Error(
        `Unexpected line break after 'async' at line ${nextToken.start.line}, column ${nextToken.start.column}.`
      );
    }

    return true;
  }

  private findArrowFromParenthesizedParams(startIndex: number): number | undefined {
    const startToken = this.tokens[startIndex];
    if (startToken?.type !== "punctuator" || startToken.value !== "(") {
      return undefined;
    }

    let depth = 0;
    for (let index = startIndex; index < this.tokens.length; index += 1) {
      const token = this.tokens[index];
      if (token.type !== "punctuator") {
        continue;
      }

      if (token.value === "(") {
        depth += 1;
        continue;
      }

      if (token.value === ")") {
        depth -= 1;
        if (depth === 0) {
          const arrowToken = this.tokens[index + 1];
          if (arrowToken?.value !== "=>") {
            return undefined;
          }

          if (hasLineBreakBetween(token, arrowToken)) {
            throw new Error(
              `Unexpected line break before '=>' at line ${arrowToken.start.line}, column ${arrowToken.start.column}.`
            );
          }

          return index + 1;
        }
      }
    }

    return undefined;
  }

  private findTopLevelForIterationOperator(startIndex: number): Token | undefined {
    let depth = 0;
    let previousToken: Token | undefined;

    for (let index = startIndex; index < this.tokens.length; index += 1) {
      const token = this.tokens[index];
      if (token.type === "punctuator") {
        if (token.value === "(" || token.value === "[" || token.value === "{") {
          depth += 1;
        } else if (token.value === ")" || token.value === "]" || token.value === "}") {
          if (depth === 0 && token.value === ")") {
            return undefined;
          }
          depth -= 1;
        } else if (depth === 0 && token.value === ";") {
          return undefined;
        }
      }

      if (
        depth === 0 &&
        token.type === "keyword" &&
        (token.value === "of" || token.value === "in") &&
        previousToken?.value !== "." &&
        previousToken?.value !== "?."
      ) {
        return token;
      }

      previousToken = token;
    }

    return undefined;
  }

  private shouldParseTopLevelStatement(): boolean {
    const token = this.currentToken();
    if (token.type === "keyword" && TOP_LEVEL_STATEMENT_KEYWORDS.has(token.value)) {
      return true;
    }

    return (
      token.type === "identifier" &&
      (token.value === "do" ||
        token.value === "switch" ||
        token.value === "var" ||
        (this.peekToken(1).type === "punctuator" && this.peekToken(1).value === ":"))
    );
  }

  private assertAllowedStatementStart(token: Token): void {
    if (token.type === "identifier" && token.value === "do") {
      throw new DisallowedSyntaxError("do/while", token.start);
    }

    if (token.type === "identifier" && token.value === "switch") {
      throw new DisallowedSyntaxError("switch", token.start);
    }

    if (token.type === "identifier" && token.value === "var") {
      throw new DisallowedSyntaxError("var", token.start);
    }

    if (token.type === "identifier" && this.peekToken(1).type === "punctuator" && this.peekToken(1).value === ":") {
      throw new DisallowedSyntaxError("label", token.start);
    }
  }

  private assertNoLabel(token: Token): void {
    if (
      this.currentToken().type === "identifier" &&
      !hasLineBreakBetween(token, this.currentToken())
    ) {
      throw new DisallowedSyntaxError("label", this.currentToken().start);
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

  private consumeKeyword(value: string): Token | undefined {
    const token = this.currentToken();
    if (token.type !== "keyword" || token.value !== value) {
      return undefined;
    }
    this.index += 1;
    return token;
  }

  private expectKeyword(value: string): Token {
    const token = this.currentToken();
    if (token.type !== "keyword" || token.value !== value) {
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

  private peekToken(offset: number): Token {
    return this.tokens[this.index + offset] ?? this.tokens[this.tokens.length - 1];
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
  return parseExpressionTokens(tokens);
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

function hasLineBreakBetween(left: Token, right: Token): boolean {
  return left.end.line !== right.start.line;
}

function unexpectedTokenError(token: Token): Error {
  if (token.type === "eof") {
    return new Error(`Unexpected end of input at line ${token.start.line}, column ${token.start.column}.`);
  }

  return new Error(`Unexpected token '${token.value}' at line ${token.start.line}, column ${token.start.column}.`);
}

function invalidAssignmentTargetError(position: Position): Error {
  return new Error(`Invalid assignment target at line ${position.line}, column ${position.column}.`);
}

function matchingOpeningPunctuator(value: ")" | "]" | "}"): "(" | "[" | "{" {
  if (value === ")") {
    return "(";
  }

  if (value === "]") {
    return "[";
  }

  return "{";
}
