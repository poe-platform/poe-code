import { boundIdentifiers } from "./bindings.js";
import { tokenize, type Position, type Token } from "./tokenizer.js";
import { assignIds } from "./assign-ids.js";
import { functionSources } from "./function-source.js";
import { formatParseError } from "./format-error.js";
import {
  createExportDefaultDeclaration,
  createExportNamedDeclaration,
  type ExportDefaultDeclaration,
  type ExportNamedDeclaration
} from "./parse-export.js";
import { createImportMeta, isImportMetaTokenSequence } from "./parse-import-meta.js";
import { parseRegex } from "../interp/regex/parse.js";
import { CompileScope, RegexCompileGuard } from "../interp/regex/compile-guard.js";
import { SandboxError, type CompileOwner } from "../interp/budget.js";

export type { ExportDefaultDeclaration, ExportNamedDeclaration } from "./parse-export.js";

const MAX_CONDITIONAL_EXPRESSION_DEPTH = 256;
const MAX_IF_STATEMENT_DEPTH = 2_048;

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
  nodeId?: number;
  type: string;
  span: SourceSpan;
};

export type Identifier = BaseNode & {
  type: "Identifier";
  name: string;
};

export type ThisExpression = BaseNode & {
  type: "ThisExpression";
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

export type RegexLiteral = BaseNode & {
  type: "RegexLiteral";
  raw: string;
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
  elision?: true;
};

export type TemplateElement = BaseNode & {
  type: "TemplateElement";
  tail: boolean;
  value: {
    raw: string;
    cooked: string | undefined;
  };
};

export type TemplateLiteral = BaseNode & {
  type: "TemplateLiteral";
  expressions: Expression[];
  quasis: TemplateElement[];
};

export type TaggedTemplateExpression = BaseNode & {
  type: "TaggedTemplateExpression";
  tag: Expression;
  quasi: TemplateLiteral;
};

export type SpreadElement = BaseNode & {
  type: "SpreadElement";
  argument: Expression;
};

export type Property = BaseNode & {
  type: "Property";
  kind?: "get" | "set";
  computed: boolean;
  shorthand: boolean;
  key: Expression;
  value: Expression;
};

export type PatternTarget = ArrayPattern | Identifier | MemberExpression | ObjectPattern;
export type AssignmentTarget = MetaProperty | PatternTarget;
export type UpdateTarget = Identifier | MemberExpression;

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
  elements: Array<
    | AssignmentPattern
    | ArrayPattern
    | Identifier
    | MemberExpression
    | ObjectPattern
    | RestElement
    | null
  >;
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

export type UnaryOperator = "!" | "+" | "-" | "~" | "delete" | "typeof" | "void";

export type UnaryExpression = BaseNode & {
  type: "UnaryExpression";
  operator: UnaryOperator;
  prefix: true;
  argument: Expression;
};

export type UpdateOperator = "++" | "--";

export type UpdateExpression = BaseNode & {
  type: "UpdateExpression";
  operator: UpdateOperator;
  prefix: boolean;
  argument: UpdateTarget;
};

export type AwaitExpression = BaseNode & {
  type: "AwaitExpression";
  argument: Expression;
};

export type YieldExpression = BaseNode & {
  type: "YieldExpression";
  argument?: Expression;
  delegate: boolean;
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
  | "instanceof"
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

export type SequenceExpression = BaseNode & {
  type: "SequenceExpression";
  expressions: Expression[];
};

export type MemberExpression = BaseNode & {
  type: "MemberExpression";
  computed: boolean;
  object: Expression;
  optional: boolean;
  property: Expression;
};

export type MetaProperty = BaseNode & {
  type: "MetaProperty";
  meta: Identifier & { name: "import" };
  property: Identifier & { name: "meta" };
};

export type AssignmentOperator =
  | "="
  | "+="
  | "-="
  | "*="
  | "/="
  | "%="
  | "**="
  | "&="
  | "|="
  | "^="
  | "<<="
  | ">>="
  | ">>>="
  | "&&="
  | "||="
  | "??=";

export type AssignmentExpression = BaseNode & {
  type: "AssignmentExpression";
  operator: AssignmentOperator;
  left: AssignmentTarget;
  right: Expression;
};

export type CallExpression = BaseNode & {
  type: "CallExpression";
  arguments: Array<Expression | SpreadElement>;
  callee: Expression;
  optional: boolean;
};

export type NewExpression = BaseNode & {
  type: "NewExpression";
  arguments: Array<Expression | SpreadElement>;
  callee: Expression;
};

export type VariableDeclarator = BaseNode & {
  type: "VariableDeclarator";
  id: ArrayPattern | Identifier | ObjectPattern;
  init?: Expression;
};

export type VariableDeclarationKind = "const" | "let" | "var";

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
  label?: string;
};

export type ContinueStatement = BaseNode & {
  type: "ContinueStatement";
  label?: string;
};

export type ExpressionStatement = BaseNode & {
  type: "ExpressionStatement";
  expression: Expression;
};

export type EmptyStatement = BaseNode & {
  type: "EmptyStatement";
};

export type BlockStatement = BaseNode & {
  type: "BlockStatement";
  body: Statement[];
};

export type FunctionDeclaration = BaseNode & {
  type: "FunctionDeclaration";
  async: boolean;
  body: BlockStatement;
  generator: boolean;
  id: Identifier;
  params: ArrowFunctionExpression["params"];
};

export type FunctionExpression = BaseNode & {
  type: "FunctionExpression";
  async: boolean;
  body: BlockStatement;
  generator: boolean;
  id?: Identifier;
  method?: true;
  params: ArrowFunctionExpression["params"];
};

export type ClassElement =
  | (BaseNode & {
      type: "MethodDefinition";
      computed: boolean;
      key: Expression;
      kind: "constructor" | "method" | "get" | "set";
      static: boolean;
      value: FunctionExpression;
    })
  | (BaseNode & {
      type: "PropertyDefinition";
      computed: boolean;
      key: Expression;
      static: boolean;
      value?: Expression;
    })
  | (BaseNode & { type: "StaticBlock"; body: BlockStatement });

export type ClassBody = BaseNode & { type: "ClassBody"; body: ClassElement[] };
export type ClassDeclaration = BaseNode & {
  type: "ClassDeclaration";
  id: Identifier;
  superClass?: Expression;
  body: ClassBody;
};
export type ClassExpression = BaseNode & {
  type: "ClassExpression";
  id?: Identifier;
  superClass?: Expression;
  body: ClassBody;
};
export type ClassNode = ClassDeclaration | ClassExpression;
export type SuperExpression = BaseNode & { type: "Super" };
export type NewTargetExpression = BaseNode & { type: "NewTargetExpression" };

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
  label?: string;
  labels?: string[];
};

export type ForOfStatement = BaseNode & {
  type: "ForOfStatement";
  left: PatternTarget | VariableDeclaration;
  right: Expression;
  body: Statement;
  label?: string;
  labels?: string[];
};

export type ForInStatement = BaseNode & {
  type: "ForInStatement";
  left: Identifier | VariableDeclaration;
  right: Expression;
  body: Statement;
  label?: string;
  labels?: string[];
};

export type WhileStatement = BaseNode & {
  type: "WhileStatement";
  test: Expression;
  body: Statement;
  label?: string;
  labels?: string[];
};

export type DoWhileStatement = BaseNode & {
  type: "DoWhileStatement";
  body: Statement;
  test: Expression;
  label?: string;
  labels?: string[];
};

export type ThrowStatement = BaseNode & {
  type: "ThrowStatement";
  argument: Expression;
};

export type CatchClause = BaseNode & {
  type: "CatchClause";
  param?: ArrayPattern | Identifier | ObjectPattern;
  body: BlockStatement;
};

export type TryStatement = BaseNode & {
  type: "TryStatement";
  block: BlockStatement;
  handler?: CatchClause;
  finalizer?: BlockStatement;
};

export type SwitchCase = BaseNode & {
  type: "SwitchCase";
  test?: Expression;
  consequent: Statement[];
};

export type SwitchStatement = BaseNode & {
  type: "SwitchStatement";
  discriminant: Expression;
  cases: SwitchCase[];
};

export type ImportSpecifier = BaseNode & {
  type: "ImportSpecifier";
  imported: Identifier;
  local: Identifier;
};

export type ImportDefaultSpecifier = BaseNode & {
  type: "ImportDefaultSpecifier";
  local: Identifier;
};

export type ImportNamespaceSpecifier = BaseNode & {
  type: "ImportNamespaceSpecifier";
  local: Identifier;
};

export type ImportDeclaration = BaseNode & {
  type: "ImportDeclaration";
  specifiers: Array<ImportDefaultSpecifier | ImportNamespaceSpecifier | ImportSpecifier>;
  source: StringLiteral;
};

export type Module = BaseNode & {
  type: "Module";
  body: Statement[];
};

export type Statement =
  | BlockStatement
  | ClassDeclaration
  | BreakStatement
  | DoWhileStatement
  | ExportDefaultDeclaration
  | ExportNamedDeclaration
  | ImportDeclaration
  | TryStatement
  | ContinueStatement
  | EmptyStatement
  | ExpressionStatement
  | FunctionDeclaration
  | ForInStatement
  | ForOfStatement
  | ForStatement
  | IfStatement
  | ReturnStatement
  | SwitchStatement
  | ThrowStatement
  | VariableDeclaration
  | WhileStatement;

export type ArrowFunctionExpression = BaseNode & {
  type: "ArrowFunctionExpression";
  async: boolean;
  body: BlockStatement | Expression;
  expression: boolean;
  params: Array<AssignmentPattern | ArrayPattern | Identifier | ObjectPattern | RestElement>;
};

export type FunctionNode = ArrowFunctionExpression | FunctionDeclaration | FunctionExpression;

export type Expression =
  | ArrowFunctionExpression
  | AssignmentExpression
  | ArrayExpression
  | AwaitExpression
  | BinaryExpression
  | BooleanLiteral
  | CallExpression
  | ConditionalExpression
  | ClassExpression
  | FunctionExpression
  | Identifier
  | LogicalExpression
  | MemberExpression
  | MetaProperty
  | NewExpression
  | NewTargetExpression
  | NullLiteral
  | NumericLiteral
  | ObjectExpression
  | RegexLiteral
  | SequenceExpression
  | StringLiteral
  | SuperExpression
  | TaggedTemplateExpression
  | TemplateLiteral
  | ThisExpression
  | UnaryExpression
  | UpdateExpression
  | UndefinedLiteral
  | YieldExpression;

export type ParseResult = Expression | Statement;

type ParsedExpression = {
  node: Expression;
  parenthesized: boolean;
};

type ExpressionParseOptions = {
  allowSequence?: boolean;
};

const EQUALITY_OPERATORS = new Set<BinaryOperator>(["==", "!=", "===", "!=="]);
const RELATIONAL_OPERATORS = new Set<BinaryOperator>(["<", "<=", ">", ">=", "in", "instanceof"]);
const SHIFT_OPERATORS = new Set<BinaryOperator>(["<<", ">>", ">>>"]);
const ADDITIVE_OPERATORS = new Set<BinaryOperator>(["+", "-"]);
const MULTIPLICATIVE_OPERATORS = new Set<BinaryOperator>(["*", "/", "%"]);
const BITWISE_OR_OPERATORS = new Set<BinaryOperator>(["|"]);
const BITWISE_XOR_OPERATORS = new Set<BinaryOperator>(["^"]);
const BITWISE_AND_OPERATORS = new Set<BinaryOperator>(["&"]);
const MAX_UNICODE_CODE_POINT = 0x10ffff;
const TOP_LEVEL_STATEMENT_KEYWORDS = new Set([
  "break",
  "class",
  "const",
  "continue",
  "do",
  "for",
  "function",
  "if",
  "import",
  "let",
  "return",
  "throw",
  "try",
  "while"
]);

export function parse(source: string, filename = "<input>", owner?: CompileOwner): ParseResult {
  const compilation = new CompileScope(owner);
  try {
    const result = assignIds(
      new Parser(
        tokenize(source, { allowRegexLiterals: true, compilation }),
        source,
        compilation
      ).parseTopLevel()
    );
    const regexLiteral = findRegexLiteral(result);
    if (regexLiteral !== undefined) {
      throw new Error(
        `Regular expression literals are not supported at line ${regexLiteral.span.start.line}, column ${regexLiteral.span.start.column}.`
      );
    }
    throwIfImportMetaAssignment(result);
    return result;
  } catch (error) {
    if (error instanceof DisallowedSyntaxError || error instanceof SandboxError) {
      throw error;
    }
    if (error instanceof Error) {
      throw formatParseError(source, filename, error);
    }
    throw error;
  } finally {
    compilation.dispose();
  }
}

export function parseModule(source: string, filename = "<input>", owner?: CompileOwner): Module {
  const compilation = new CompileScope(owner);
  try {
    return assignIds(
      new Parser(
        tokenize(source, { allowRegexLiterals: true, compilation }),
        source,
        compilation
      ).parseModule()
    );
  } catch (error) {
    if (error instanceof DisallowedSyntaxError || error instanceof SandboxError) {
      throw error;
    }
    if (error instanceof Error) {
      throw formatParseError(source, filename, error);
    }
    throw error;
  } finally {
    compilation.dispose();
  }
}

export function parseExecutableModule(
  source: string,
  filename = "<input>",
  owner?: CompileOwner
): Module {
  const compilation = new CompileScope(owner);
  try {
    const result = assignIds(
      new Parser(
        tokenize(source, { allowRegexLiterals: true, compilation }),
        source,
        compilation
      ).parseModule()
    );
    throwIfImportMetaAssignment(result);
    return result;
  } catch (error) {
    if (error instanceof DisallowedSyntaxError || error instanceof SandboxError) {
      throw error;
    }
    if (error instanceof Error) {
      throw formatParseError(source, filename, error);
    }
    throw error;
  } finally {
    compilation.dispose();
  }
}

type ParserBindingKind = "lexical" | "function" | "parameter" | "catch";
type ParserScope = Map<string, ParserBindingKind>;
type FunctionParseContext = "normal" | "generator" | "parameters";
type LexicalParseContext = {
  newTarget: boolean;
  superProperty: boolean;
  superCall: boolean;
  arguments: boolean;
  return: boolean;
  await: boolean;
  strictAwait?: boolean;
};
const ordinaryFunctionContext: LexicalParseContext = {
  newTarget: true, superProperty: false, superCall: false,
  arguments: true, return: true, await: true
};

class Parser {
  private index = 0;
  private breakableDepth = 0;
  private conditionalExpressionDepth = 0;
  private ifStatementDepth = 0;
  private loopDepth = 0;
  private readonly scopes: ParserScope[] = [new Map()];
  private readonly functionScopes = new WeakSet<ParserScope>();
  private readonly varNames = new WeakMap<ParserScope, Set<string>>();

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
    private readonly compilation?: CompileScope,
    private functionContext: FunctionParseContext = "normal",
    private lexicalContext: LexicalParseContext = { ...ordinaryFunctionContext, newTarget: false }
  ) {
    this.functionScopes.add(this.scopes[0]!);
  }

  private withFunctionSource<T extends FunctionNode | ClassNode>(node: T): T {
    functionSources.set(node, {
      text: this.source,
      start: node.span.start.offset,
      end: node.span.end.offset
    });
    return node;
  }

  parseTopLevel(): ParseResult {
    if (this.isExportToken(this.currentToken())) {
      throw new DisallowedSyntaxError("export", this.currentToken().start);
    }

    const node = this.shouldParseTopLevelStatement()
      ? this.parseStatement()
      : this.parseExpression({ allowSequence: true }).node;
    while (this.consumePunctuator(";") !== undefined) {
      continue;
    }
    this.expectEof();
    return node;
  }

  parseModule(): Module {
    const body: Statement[] = [];

    while (this.currentToken().type !== "eof") {
      const statement = this.parseTopLevelItem();
      body.push(statement);
      while (statement.type !== "EmptyStatement" && this.consumePunctuator(";") !== undefined) {
        continue;
      }
    }

    const end = this.currentToken().end;
    return {
      type: "Module",
      body,
      span: createSpan(body[0]?.span.start ?? end, body[body.length - 1]?.span.end ?? end)
    };
  }

  parseExpressionOnly(): Expression {
    const expression = this.parseExpression({ allowSequence: true }).node;
    while (this.consumePunctuator(";") !== undefined) {
      continue;
    }
    this.expectEof();
    return expression;
  }

  private parseTopLevelItem(): Statement {
    const emptyStatement = this.parseEmptyStatement();
    if (emptyStatement !== undefined) {
      return emptyStatement;
    }

    if (this.isExportToken(this.currentToken())) {
      return this.parseExportDeclaration();
    }

    const token = this.currentToken();
    if (
      token.type === "keyword" &&
      token.value === "return" &&
      !this.hasReturnArgument(token, this.peekToken(1))
    ) {
      throw new Error(
        `Top-level return statements must return a value at line ${token.start.line}, column ${token.start.column}.`
      );
    }

    if (
      this.shouldParseTopLevelStatement() ||
      (this.currentToken().type === "punctuator" && this.currentToken().value === "{")
    ) {
      return this.parseStatement();
    }

    const expression = this.parseExpression({ allowSequence: true }).node;
    return {
      type: "ExpressionStatement",
      expression,
      span: expression.span
    };
  }

  private parseExpression(options: ExpressionParseOptions = {}): ParsedExpression {
    const first = this.parseAssignmentExpression();
    if (options.allowSequence !== true || this.consumePunctuator(",") === undefined) {
      return first;
    }

    const expressions = [first.node];
    do {
      expressions.push(this.parseAssignmentExpression().node);
    } while (this.consumePunctuator(",") !== undefined);

    return {
      node: {
        type: "SequenceExpression",
        expressions,
        span: createSpan(expressions[0]!.span.start, expressions[expressions.length - 1]!.span.end)
      },
      parenthesized: false
    };
  }

  private parseAssignmentExpression(): ParsedExpression {
    const arrowFunction = this.tryParseArrowFunctionExpression();
    if (arrowFunction !== undefined) {
      return {
        node: arrowFunction,
        parenthesized: false
      };
    }

    const patternAssignment = this.tryParsePatternAssignmentExpression();
    if (patternAssignment !== undefined) {
      return {
        node: patternAssignment,
        parenthesized: false
      };
    }

    const left = this.parseConditionalExpression();
    const operator = this.consumeAssignmentOperator();
    if (operator === undefined) {
      return left;
    }

    const right = this.parseAssignmentExpression();
    return {
      node: {
        type: "AssignmentExpression",
        operator,
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
    this.withScope(() => {
      for (const param of params) {
        for (const identifier of boundIdentifiers(param)) this.declareBinding(identifier);
      }
    });
    this.expectPunctuator("=>");
    const body = this.withLexicalContext({
      ...this.lexicalContext, return: true, await: isAsync || this.lexicalContext.strictAwait !== true
    }, () => this.parseArrowFunctionBody(params));
    return this.withFunctionSource({
      type: "ArrowFunctionExpression",
      async: isAsync,
      body,
      expression: body.type !== "BlockStatement",
      params,
      span: createSpan(start, body.span.end)
    });
  }

  private parseConditionalExpression(): ParsedExpression {
    if (this.conditionalExpressionDepth >= MAX_CONDITIONAL_EXPRESSION_DEPTH) {
      const token = this.currentToken();
      throw new Error(
        `Conditional expression nesting limit exceeded at line ${token.start.line}, column ${token.start.column}.`
      );
    }

    this.conditionalExpressionDepth += 1;
    try {
      const test = this.parseCoalesceExpression();
      if (this.consumePunctuator("?") === undefined) {
        return test;
      }

      const consequent = this.parseExpression();
      this.expectPunctuator(":");
      const alternate = this.parseAssignmentExpression();
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
    } finally {
      this.conditionalExpressionDepth -= 1;
    }
  }

  private parseArrowFunctionBody(
    params: ArrowFunctionExpression["params"]
  ): BlockStatement | Expression {
    if (this.currentToken().type === "punctuator" && this.currentToken().value === "{") {
      return this.withFunctionContext("normal", () => this.parseBlockStatement(params));
    }

    return this.withFunctionContext("normal", () => this.parseExpression().node);
  }

  private parseBlockStatement(
    params?: ArrowFunctionExpression["params"],
    catchParam?: CatchClause["param"]
  ): BlockStatement {
    const start = this.expectPunctuator("{");
    return this.withScope(() => {
      for (const param of params ?? []) {
        for (const identifier of boundIdentifiers(param)) {
          this.declareBinding(identifier, "parameter");
        }
      }
      if (catchParam !== undefined) {
        for (const identifier of boundIdentifiers(catchParam)) {
          this.declareBinding(identifier, catchParam.type === "Identifier" ? "catch" : "lexical");
        }
      }
      return this.parseBlockStatementBody(start);
    }, params !== undefined);
  }

  private parseBlockStatementBody(start: Token): BlockStatement {
    const body: Statement[] = [];

    while (this.consumePunctuator("}") === undefined) {
      if (this.currentToken().type === "eof") {
        throw new Error(
          `Unterminated block at line ${start.start.line}, column ${start.start.column}.`
        );
      }

      const statement = this.parseStatement();
      body.push(statement);
      while (statement.type !== "EmptyStatement" && this.consumePunctuator(";") !== undefined) {
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
    const emptyStatement = this.parseEmptyStatement();
    if (emptyStatement !== undefined) {
      return emptyStatement;
    }

    const token = this.currentToken();

    if (
      token.type === "identifier" &&
      this.peekToken(1).type === "punctuator" &&
      this.peekToken(1).value === ":"
    ) {
      this.index += 2;
      return this.parseLabeledStatement([token.value], token);
    }

    this.assertAllowedStatementStart(token);

    if (token.value === "class") return this.parseClass(true) as ClassDeclaration;
    if (token.value === "return" && !this.lexicalContext.return)
      throw new DisallowedSyntaxError("return in a static block", token.start);

    if (token.type === "punctuator" && token.value === "{") {
      return this.parseBlockStatement();
    }

    if (token.type === "keyword" && token.value === "if") {
      return this.parseIfStatement();
    }

    if (token.type === "identifier" && token.value === "switch") {
      return this.parseSwitchStatement();
    }

    if (
      (token.type === "keyword" && token.value === "function") ||
      this.isAsyncFunctionDeclarationStart()
    ) {
      return this.parseFunctionDeclaration();
    }

    if (token.type === "keyword" && token.value === "for") {
      return this.parseForStatement();
    }

    if (token.type === "keyword" && token.value === "while") {
      return this.parseWhileStatement();
    }

    if (token.type === "keyword" && token.value === "do") {
      return this.parseDoWhileStatement();
    }

    if (token.type === "keyword" && token.value === "try") {
      return this.parseTryStatement();
    }

    if (token.type === "keyword" && token.value === "import" && !this.isImportMetaStart()) {
      return this.parseImportDeclaration();
    }

    if (token.type === "keyword" && token.value === "return") {
      this.index += 1;
      const hasArgument = this.hasReturnArgument(token, this.currentToken());
      const argument = hasArgument ? this.parseExpression({ allowSequence: true }).node : undefined;
      const end = argument?.span.end ?? token.end;
      return {
        type: "ReturnStatement",
        argument,
        span: createSpan(token.start, end)
      };
    }

    if (token.type === "keyword" && token.value === "throw") {
      this.index += 1;
      if (hasLineBreakBetween(token, this.currentToken())) {
        throw new Error(
          `Illegal newline after throw at line ${token.start.line}, column ${token.start.column}.`
        );
      }
      if (
        this.currentToken().type === "punctuator" &&
        (this.currentToken().value === ";" || this.currentToken().value === "}")
      ) {
        throw unexpectedTokenError(this.currentToken());
      }
      if (this.currentToken().type === "eof") {
        throw unexpectedTokenError(this.currentToken());
      }
      const argument = this.parseExpression({ allowSequence: true }).node;
      return {
        type: "ThrowStatement",
        argument,
        span: createSpan(token.start, argument.span.end)
      };
    }

    if (
      (token.type === "keyword" && (token.value === "const" || token.value === "let")) ||
      (token.type === "identifier" && token.value === "var")
    ) {
      return this.parseVariableDeclaration();
    }

    if (token.type === "keyword" && token.value === "break") {
      if (this.breakableDepth === 0) {
        throw new Error(
          `Illegal break statement outside a loop or switch at line ${token.start.line}, column ${token.start.column}.`
        );
      }
      this.index += 1;
      const label = this.consumeControlLabel(token);
      return {
        type: "BreakStatement",
        ...(label === undefined ? {} : { label: label.value }),
        span: createSpan(token.start, label?.end ?? token.end)
      };
    }

    if (token.type === "keyword" && token.value === "continue") {
      if (this.loopDepth === 0) {
        throw new Error(
          `Illegal continue statement outside a loop at line ${token.start.line}, column ${token.start.column}.`
        );
      }
      this.index += 1;
      const label = this.consumeControlLabel(token);
      return {
        type: "ContinueStatement",
        ...(label === undefined ? {} : { label: label.value }),
        span: createSpan(token.start, label?.end ?? token.end)
      };
    }

    const expression = this.parseExpression({ allowSequence: true }).node;
    return {
      type: "ExpressionStatement",
      expression,
      span: createSpan(expression.span.start, expression.span.end)
    };
  }

  private parseEmptyStatement(): EmptyStatement | undefined {
    const token = this.consumePunctuator(";");
    if (token === undefined) {
      return undefined;
    }

    return {
      type: "EmptyStatement",
      span: createTokenSpan(token)
    };
  }

  private parseLabeledStatement(labels: string[], firstLabelToken: Token): Statement {
    const token = this.currentToken();

    if (
      token.type === "identifier" &&
      this.peekToken(1).type === "punctuator" &&
      this.peekToken(1).value === ":"
    ) {
      this.index += 2;
      return this.parseLabeledStatement([...labels, token.value], firstLabelToken);
    }

    if (token.type === "keyword" && token.value === "for") {
      return this.parseForStatement(labels);
    }

    if (token.type === "keyword" && token.value === "while") {
      return this.parseWhileStatement(labels);
    }

    if (token.type === "keyword" && token.value === "do") {
      return this.parseDoWhileStatement(labels);
    }

    throw new DisallowedSyntaxError("label", firstLabelToken.start);
  }

  private parseIfStatement(): IfStatement {
    if (this.ifStatementDepth >= MAX_IF_STATEMENT_DEPTH) {
      const token = this.currentToken();
      throw new Error(
        `If statement nesting limit exceeded at line ${token.start.line}, column ${token.start.column}.`
      );
    }

    this.ifStatementDepth += 1;
    try {
      const ifToken = this.expectKeyword("if");
      this.expectPunctuator("(");
      const test = this.parseExpression({ allowSequence: true }).node;
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
    } finally {
      this.ifStatementDepth -= 1;
    }
  }

  private parseSwitchStatement(): SwitchStatement {
    const switchToken = this.currentToken();
    this.index += 1;
    this.expectPunctuator("(");
    const discriminant = this.parseExpression({ allowSequence: true }).node;
    this.expectPunctuator(")");
    const openBrace = this.expectPunctuator("{");

    return this.withScope(() =>
      this.withBreakableContext(() => {
        const cases: SwitchCase[] = [];
        let hasDefault = false;

        while (this.consumePunctuator("}") === undefined) {
          if (this.currentToken().type === "eof") {
            throw new Error(
              `Unterminated switch statement at line ${openBrace.start.line}, column ${openBrace.start.column}.`
            );
          }

          const clauseToken = this.currentToken();
          let test: Expression | undefined;
          if (clauseToken.type === "identifier" && clauseToken.value === "case") {
            this.index += 1;
            test = this.parseExpression({ allowSequence: true }).node;
          } else if (clauseToken.type === "identifier" && clauseToken.value === "default") {
            if (hasDefault) {
              throw new Error(
                `Duplicate default clause at line ${clauseToken.start.line}, column ${clauseToken.start.column}.`
              );
            }
            hasDefault = true;
            this.index += 1;
          } else {
            throw unexpectedTokenError(clauseToken);
          }

          const colon = this.expectPunctuator(":");
          const consequent: Statement[] = [];
          while (!this.isSwitchClauseStart() && !this.isCurrentPunctuator("}")) {
            const statement = this.parseStatement();
            consequent.push(statement);
            while (
              statement.type !== "EmptyStatement" &&
              this.consumePunctuator(";") !== undefined
            ) {
              continue;
            }
          }

          cases.push({
            type: "SwitchCase",
            test,
            consequent,
            span: createSpan(clauseToken.start, consequent.at(-1)?.span.end ?? colon.end)
          });
        }

        return {
          type: "SwitchStatement",
          discriminant,
          cases,
          span: createSpan(switchToken.start, this.previousToken().end)
        };
      })
    );
  }

  private isSwitchClauseStart(): boolean {
    const token = this.currentToken();
    return token.type === "identifier" && (token.value === "case" || token.value === "default");
  }

  private isCurrentPunctuator(value: string): boolean {
    const token = this.currentToken();
    return token.type === "punctuator" && token.value === value;
  }

  private parseForStatement(labels?: string[]): ForInStatement | ForOfStatement | ForStatement {
    const forToken = this.expectKeyword("for");
    return this.withScope(() => {
      this.expectPunctuator("(");
      const iterationOperator = this.findTopLevelForIterationOperator(this.index);

      if (iterationOperator?.value === "in") {
        const left = this.parseForInLeft();
        this.expectKeyword("in");
        const right = this.parseExpression().node;
        this.expectPunctuator(")");
        const body = this.withLoopContext(() => this.parseStatement());
        return {
          type: "ForInStatement",
          left,
          right,
          body,
          ...createLoopLabelFields(labels),
          span: createSpan(forToken.start, body.span.end)
        };
      }

      if (iterationOperator?.value === "of") {
        const left = this.parseForOfLeft();
        this.expectKeyword("of");
        const right = this.parseExpression().node;
        this.expectPunctuator(")");
        const body = this.withLoopContext(() => this.parseStatement());
        return {
          type: "ForOfStatement",
          left,
          right,
          body,
          ...createLoopLabelFields(labels),
          span: createSpan(forToken.start, body.span.end)
        };
      }

      let init: Expression | VariableDeclaration | undefined;
      if (this.consumePunctuator(";") === undefined) {
        init =
          (this.currentToken().type === "keyword" || this.currentToken().type === "identifier") &&
          (this.currentToken().value === "const" ||
            this.currentToken().value === "let" ||
            this.currentToken().value === "var")
            ? this.parseVariableDeclaration()
            : this.parseExpression({ allowSequence: true }).node;
        this.expectPunctuator(";");
      }

      let test: Expression | undefined;
      if (this.consumePunctuator(";") === undefined) {
        test = this.parseExpression({ allowSequence: true }).node;
        this.expectPunctuator(";");
      }

      const update =
        this.currentToken().type === "punctuator" && this.currentToken().value === ")"
          ? undefined
          : this.parseExpression({ allowSequence: true }).node;

      this.expectPunctuator(")");
      const body = this.withLoopContext(() => this.parseStatement());
      return {
        type: "ForStatement",
        init,
        test,
        update,
        body,
        ...createLoopLabelFields(labels),
        span: createSpan(forToken.start, body.span.end)
      };
    });
  }

  private parseForInLeft(): Identifier | VariableDeclaration {
    const left = this.parseForOfLeft();
    const target = left.type === "VariableDeclaration" ? left.declarations[0]?.id : left;
    if (target?.type !== "Identifier") {
      throw new Error("for...in keys are strings; destructure inside the body");
    }
    return left as Identifier | VariableDeclaration;
  }

  private parseForOfLeft(): PatternTarget | VariableDeclaration {
    if (
      (this.currentToken().type === "keyword" || this.currentToken().type === "identifier") &&
      (this.currentToken().value === "const" ||
        this.currentToken().value === "let" ||
        this.currentToken().value === "var")
    ) {
      return this.parseForOfDeclaration();
    }

    return this.toPatternTarget(this.parseAssignmentTarget());
  }

  private parseForOfDeclaration(): VariableDeclaration {
    const kindToken = this.currentToken();
    if (
      (kindToken.type !== "keyword" && kindToken.type !== "identifier") ||
      (kindToken.value !== "const" && kindToken.value !== "let" && kindToken.value !== "var")
    ) {
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
    this.declarePatternBindings(id);

    return {
      type: "VariableDeclaration",
      declarations: [declarator],
      kind: kindToken.value,
      span: createSpan(kindToken.start, id.span.end)
    };
  }

  private parseWhileStatement(labels?: string[]): WhileStatement {
    const whileToken = this.expectKeyword("while");
    this.expectPunctuator("(");
    const test = this.parseExpression({ allowSequence: true }).node;
    this.expectPunctuator(")");
    const body = this.withLoopContext(() => this.parseStatement());
    return {
      type: "WhileStatement",
      test,
      body,
      ...createLoopLabelFields(labels),
      span: createSpan(whileToken.start, body.span.end)
    };
  }

  private parseDoWhileStatement(labels?: string[]): DoWhileStatement {
    const doToken = this.expectKeyword("do");
    const body = this.withLoopContext(() => this.parseStatement());
    this.expectKeyword("while");
    this.expectPunctuator("(");
    const test = this.parseExpression({ allowSequence: true }).node;
    const closeParen = this.expectPunctuator(")");
    return {
      type: "DoWhileStatement",
      body,
      test,
      ...createLoopLabelFields(labels),
      span: createSpan(doToken.start, closeParen.end)
    };
  }

  private parseTryStatement(): TryStatement {
    const tryToken = this.expectKeyword("try");
    const block = this.parseBlockStatement();
    const handler =
      this.currentToken().type === "keyword" && this.currentToken().value === "catch"
        ? this.parseCatchClause()
        : undefined;

    let finalizer: BlockStatement | undefined;
    if (this.currentToken().type === "keyword" && this.currentToken().value === "finally") {
      this.index += 1;
      finalizer = this.parseBlockStatement();
    }

    if (this.currentToken().type === "keyword" && this.currentToken().value === "catch") {
      throw new Error(
        `Try statements support only one catch clause at line ${this.currentToken().start.line}, column ${this.currentToken().start.column}.`
      );
    }

    if (handler === undefined && finalizer === undefined) {
      throw new Error(
        `Expected 'catch' or 'finally' at line ${this.currentToken().start.line}, column ${this.currentToken().start.column}.`
      );
    }

    return {
      type: "TryStatement",
      block,
      handler,
      finalizer,
      span: createSpan(tryToken.start, finalizer?.span.end ?? handler?.span.end ?? block.span.end)
    };
  }

  private parseImportDeclaration(): ImportDeclaration {
    const importToken = this.expectKeyword("import");
    let specifiers: ImportDeclaration["specifiers"];

    if (this.currentToken().type === "punctuator" && this.currentToken().value === "{") {
      specifiers = this.parseImportNamedSpecifiers();
    } else if (this.currentToken().type === "punctuator" && this.currentToken().value === "*") {
      const start = this.expectPunctuator("*");
      this.expectKeyword("as");
      const local = this.parseBindingIdentifier();
      specifiers = [
        {
          type: "ImportNamespaceSpecifier",
          local,
          span: createSpan(start.start, local.span.end)
        }
      ];
    } else {
      const local = this.parseBindingIdentifier();
      specifiers = [
        {
          type: "ImportDefaultSpecifier",
          local,
          span: local.span
        }
      ];
    }

    const fromToken = this.currentToken();
    if (
      fromToken.type !== "identifier" ||
      fromToken.value !== "from" ||
      fromToken.end.offset - fromToken.start.offset !== fromToken.value.length
    ) {
      throw new Error(
        `Expected 'from' at line ${fromToken.start.line}, column ${fromToken.start.column}.`
      );
    }
    this.index += 1;
    const sourceToken = this.currentToken();
    if (sourceToken.type !== "string") {
      throw unexpectedTokenError(sourceToken);
    }

    this.index += 1;
    const source = createStringLiteral(sourceToken);
    assertBareImportSpecifier(source);

    return {
      type: "ImportDeclaration",
      specifiers,
      source,
      span: createSpan(importToken.start, source.span.end)
    };
  }

  private parseImportNamedSpecifiers(): ImportDeclaration["specifiers"] {
    this.expectPunctuator("{");
    const specifiers: ImportDeclaration["specifiers"] = [];

    while (true) {
      const imported = this.parseIdentifierName();
      let local = imported;

      if (this.consumeKeyword("as") !== undefined) {
        local = this.parseBindingIdentifier();
      }

      specifiers.push({
        type: "ImportSpecifier",
        imported,
        local,
        span: createSpan(imported.span.start, local.span.end)
      });

      const comma = this.consumePunctuator(",");
      if (comma === undefined) {
        break;
      }

      if (this.currentToken().type === "punctuator" && this.currentToken().value === "}") {
        break;
      }
    }

    if (specifiers.length === 0) {
      throw unexpectedTokenError(this.currentToken());
    }

    this.expectPunctuator("}");
    return specifiers;
  }

  private parseExportDeclaration(): ExportDefaultDeclaration | ExportNamedDeclaration {
    const exportToken = this.currentToken();
    if (!this.isExportToken(exportToken)) {
      throw unexpectedTokenError(exportToken);
    }

    this.index += 1;

    if (this.currentToken().value === "default") {
      return this.parseExportDefaultDeclaration(exportToken);
    }

    if (this.currentToken().type === "keyword" && this.currentToken().value === "const") {
      return this.parseExportNamedDeclaration(exportToken);
    }

    throw new DisallowedSyntaxError(`export ${this.currentToken().value}`, exportToken.start);
  }

  private parseExportNamedDeclaration(exportToken: Token): ExportNamedDeclaration {
    const declaration = this.parseVariableDeclaration();
    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== "Identifier") {
        throw new DisallowedSyntaxError("export const", declarator.id.span.start);
      }
    }

    return createExportNamedDeclaration(exportToken, declaration);
  }

  private parseExportDefaultDeclaration(exportToken: Token): ExportDefaultDeclaration {
    this.index += 1;

    if (this.currentToken().value === "class") {
      throw new DisallowedSyntaxError(
        `export default ${this.currentToken().value}`,
        this.currentToken().start
      );
    }

    const declaration = this.parseExpression().node;
    return createExportDefaultDeclaration(exportToken, declaration);
  }

  private parseCatchClause(): CatchClause {
    const catchToken = this.expectKeyword("catch");
    let param: ArrayPattern | Identifier | ObjectPattern | undefined;
    if (this.consumePunctuator("(") !== undefined) {
      param = this.parseBindingTarget();
      this.expectPunctuator(")");
    }
    const body = this.parseBlockStatement(undefined, param);
    return {
      type: "CatchClause",
      param,
      body,
      span: createSpan(catchToken.start, body.span.end)
    };
  }

  private parseVariableDeclaration(): VariableDeclaration {
    const kindToken = this.currentToken();
    if (
      (kindToken.type !== "keyword" && kindToken.type !== "identifier") ||
      (kindToken.value !== "const" && kindToken.value !== "let" && kindToken.value !== "var")
    ) {
      throw unexpectedTokenError(kindToken);
    }

    this.index += 1;
    const declarations: VariableDeclaration["declarations"] = [];

    while (true) {
      const declarator = this.parseVariableDeclarator(kindToken.value);
      if (kindToken.value !== "var") {
        this.declarePatternBindings(declarator.id);
      } else {
        for (const identifier of boundIdentifiers(declarator.id)) {
          this.declareVarBinding(identifier);
        }
      }
      declarations.push(declarator);
      const comma = this.consumePunctuator(",");
      if (comma === undefined) {
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

  private parseFunctionDeclaration(): FunctionDeclaration {
    const asyncToken = this.consumeKeyword("async");
    const functionToken = this.expectKeyword("function");
    const generatorToken = this.consumePunctuator("*");
    if (asyncToken !== undefined && generatorToken !== undefined) {
      throw new Error(
        `async function* is not supported at line ${asyncToken.start.line}, column ${asyncToken.start.column}.`
      );
    }
    const id = this.parseBindingIdentifier();
    this.declareBinding(id, "function");
    const generator = generatorToken !== undefined;
    const { params, body } = this.parseFunctionParts(generator, ordinaryFunctionContext);

    return this.withFunctionSource({
      type: "FunctionDeclaration",
      async: asyncToken !== undefined,
      body,
      generator,
      id,
      params,
      span: createSpan(asyncToken?.start ?? functionToken.start, body.span.end)
    });
  }

  private parseClass(declaration: boolean): ClassNode {
    const start = this.expectKeyword("class");
    const id = isIdentifierLikeToken(this.currentToken()) && this.currentToken().value !== "extends"
      ? this.parseBindingIdentifier()
      : undefined;
    if (declaration && id === undefined) throw unexpectedTokenError(this.currentToken());
    if (declaration) this.declareBinding(id!);
    return this.withScope(() => {
      if (id !== undefined) this.declareBinding(id);
      const superClass = this.consumeKeyword("extends") === undefined
        ? undefined
        : this.parseLeftHandSideExpression().node;
      const open = this.expectPunctuator("{");
      const elements: ClassElement[] = [];
      let constructorSeen = false;
      while (this.consumePunctuator("}") === undefined) {
        if (this.currentToken().type === "eof") throw unexpectedTokenError(this.currentToken());
        if (this.consumePunctuator(";") !== undefined) continue;
        const element = this.parseClassElement(superClass !== undefined);
        if (element.type === "MethodDefinition" && element.kind === "constructor") {
          if (constructorSeen) throw new Error("A class may only have one constructor.");
          constructorSeen = true;
        }
        elements.push(element);
      }
      const body: ClassBody = {
        type: "ClassBody", body: elements,
        span: createSpan(open.start, this.previousToken().end)
      };
      return this.withFunctionSource({
        type: declaration ? "ClassDeclaration" : "ClassExpression",
        id, superClass, body, span: createSpan(start.start, body.span.end)
      } as ClassNode);
    });
  }

  private parseFunctionParts(
    generator: boolean,
    lexicalContext: LexicalParseContext,
    accessor?: "get" | "set"
  ): {
    params: ArrowFunctionExpression["params"];
    body: BlockStatement;
  } {
    return this.withLexicalContext(lexicalContext, () => {
      const params = this.withScope(() => {
        const parsed = this.parseArrowParameters();
        for (const param of parsed)
          for (const identifier of boundIdentifiers(param)) this.declareBinding(identifier);
        return parsed;
      });
      if (accessor === "get" && params.length !== 0)
        throw new Error("A getter cannot have parameters.");
      if (accessor === "set" && (params.length !== 1 || params[0]?.type === "RestElement"))
        throw new Error("A setter must have exactly one non-rest parameter.");
      const bodyTokenIndex = this.index;
      const body = this.withFunctionContext(generator ? "generator" : "normal", () => this.parseBlockStatement(params));
      if (accessor === "set" && params[0]?.type !== "Identifier") {
        let directiveTokenIndex = bodyTokenIndex + 1;
        for (const statement of body.body) {
          const token = this.tokens[directiveTokenIndex];
          if (
            statement.type !== "ExpressionStatement" ||
            statement.expression.type !== "StringLiteral" ||
            token?.type !== "string" ||
            statement.span.start.offset !== token.start.offset ||
            statement.span.end.offset !== token.end.offset
          ) break;
          if (statement.expression.raw === '"use strict"' || statement.expression.raw === "'use strict'")
            throw new Error(
              "A setter with a non-simple parameter cannot contain a use strict directive."
            );
          directiveTokenIndex += this.tokens[directiveTokenIndex + 1]?.value === ";" ? 2 : 1;
        }
      }
      return { params, body };
    });
  }

  private parseClassElement(derived: boolean): ClassElement {
    const start = this.currentToken();
    let isStatic = false;
    if (start.value === "static" && !["(", "=", ";", "}"].includes(this.peekToken(1).value)) {
      this.index++;
      isStatic = true;
      if (this.currentToken().value === "{") {
        const body = this.withLexicalContext({
          newTarget: true, superProperty: true, superCall: false,
          arguments: false, return: false, await: false, strictAwait: true
        }, () => this.withFunctionContext("normal", () => this.parseBlockStatement([])));
        return { type: "StaticBlock", body, span: createSpan(start.start, body.span.end) };
      }
    }
    const methodStart = this.currentToken();
    let async = false;
    if (methodStart.value === "async" && !hasLineBreakBetween(methodStart, this.peekToken(1)) &&
        (this.peekToken(1).value === "*" || this.isObjectMethodStart())) {
      this.index++;
      async = true;
    }
    const generator = this.consumePunctuator("*") !== undefined;
    if (async && generator) throw new DisallowedSyntaxError("async generator", methodStart.start);
    let accessor: "get" | "set" | undefined;
    const modifier = this.currentToken();
    if ((modifier.value === "get" || modifier.value === "set") && this.isObjectMethodStart()) {
      if (async || generator || modifier.end.offset - modifier.start.offset !== modifier.value.length)
        throw unexpectedTokenError(modifier);
      accessor = modifier.value;
      this.index++;
    }
    const computed = this.consumePunctuator("[") !== undefined;
    const key = computed
      ? this.parseExpression({ allowSequence: true }).node
      : this.currentToken().type === "string"
        ? createStringLiteral(this.tokens[this.index++]!)
        : this.currentToken().type === "numeric"
          ? createNumericLiteral(this.tokens[this.index++]!)
          : this.parseIdentifierName();
    if (computed) this.expectPunctuator("]");
    const name = computed ? undefined : key.type === "Identifier" ? key.name
      : key.type === "StringLiteral" || key.type === "NumericLiteral" ? String(key.value) : undefined;
    if (isStatic && name === "prototype") throw new Error("A static class element cannot be named prototype.");
    if (this.currentToken().value === "(") {
      const constructor = !isStatic && name === "constructor";
      if (constructor && (async || generator || accessor !== undefined)) throw new Error("A class constructor must be an ordinary method.");
      const { params, body } = this.parseFunctionParts(generator, {
        newTarget: true, superProperty: true, superCall: constructor && derived,
        arguments: true, return: true, await: async, strictAwait: true
      }, accessor);
      const value = this.withFunctionSource({
        type: "FunctionExpression", async, generator, method: true, params, body,
        span: createSpan(methodStart.start, body.span.end)
      } as FunctionExpression);
      return {
        type: "MethodDefinition", key, computed, static: isStatic,
        kind: accessor ?? (constructor ? "constructor" : "method"), value,
        span: createSpan(start.start, value.span.end)
      };
    }
    if (async || generator) throw unexpectedTokenError(this.currentToken());
    if (name === "constructor") throw new Error("A class field cannot be named constructor.");
    const value = this.consumePunctuator("=") === undefined ? undefined : this.withLexicalContext({
      newTarget: true, superProperty: true, superCall: false,
      arguments: false, return: false, await: false, strictAwait: true
    }, () => this.withFunctionContext("normal", () => this.parseExpression().node));
    const end = value?.span.end ?? key.span.end;
    if (this.consumePunctuator(";") === undefined && this.currentToken().value !== "}" &&
        !hasLineBreakBetween(this.previousToken(), this.currentToken()))
      throw unexpectedTokenError(this.currentToken());
    return { type: "PropertyDefinition", key, computed, static: isStatic, value, span: createSpan(start.start, end) };
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
    return this.withFunctionContext("parameters", () => {
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
    });
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

    if (isIdentifierLikeToken(token)) {
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
    if (!isIdentifierLikeToken(token)) {
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
        if (this.currentToken().type === "punctuator" && this.currentToken().value === "...") {
          throw new Error(
            `Object pattern can contain only one rest element at line ${this.currentToken().start.line}, column ${this.currentToken().start.column}.`
          );
        }
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
    if (token.type === "identifier" || token.type === "keyword") {
      this.index += 1;
      const key = createIdentifierName(token);
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

      if (!isIdentifierLikeToken(token)) throw unexpectedTokenError(token);
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

    const left =
      token.value === "["
        ? this.parseAssignmentArrayPattern()
        : this.parseAssignmentObjectPattern();
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
      const argument = this.toPatternTarget(this.parseAssignmentTarget());
      return {
        type: "RestElement",
        argument,
        span: createSpan(start, argument.span.end)
      };
    }

    const left = this.parseAssignmentTarget();
    if (this.consumePunctuator("=") === undefined) {
      return this.toPatternTarget(left);
    }

    const right = this.parseAssignmentExpression().node;
    return {
      type: "AssignmentPattern",
      left: this.toPatternTarget(left),
      right,
      span: createSpan(left.span.start, right.span.end)
    };
  }

  private parseAssignmentTarget(): AssignmentTarget {
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

    if (
      expression.type === "MetaProperty" ||
      (expression.type === "MemberExpression" && !expression.optional)
    ) {
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
        if (this.currentToken().type === "punctuator" && this.currentToken().value === "...") {
          throw new Error(
            `Object pattern can contain only one rest element at line ${this.currentToken().start.line}, column ${this.currentToken().start.column}.`
          );
        }
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
    if (token.type === "identifier" || token.type === "keyword") {
      this.index += 1;
      const key = createIdentifierName(token);
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

      if (!isIdentifierLikeToken(token)) throw unexpectedTokenError(token);
      let value: AssignmentPattern | ArrayPattern | Identifier | MemberExpression | ObjectPattern =
        key;
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

  private parsePatternComputedKey(): Expression {
    const key = this.parseExpression({ allowSequence: true }).node;
    this.expectPunctuator("]");

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
    return this.parseLogicalExpression(() => this.parseLogicalAndExpression(), "||");
  }

  private parseLogicalAndExpression(): ParsedExpression {
    return this.parseLogicalExpression(() => this.parseBitwiseOrExpression(), "&&");
  }

  private parseBitwiseOrExpression(): ParsedExpression {
    return this.parseBinaryExpression(() => this.parseBitwiseXorExpression(), BITWISE_OR_OPERATORS);
  }

  private parseBitwiseXorExpression(): ParsedExpression {
    return this.parseBinaryExpression(
      () => this.parseBitwiseAndExpression(),
      BITWISE_XOR_OPERATORS
    );
  }

  private parseBitwiseAndExpression(): ParsedExpression {
    return this.parseBinaryExpression(() => this.parseEqualityExpression(), BITWISE_AND_OPERATORS);
  }

  private parseEqualityExpression(): ParsedExpression {
    return this.parseBinaryExpression(() => this.parseRelationalExpression(), EQUALITY_OPERATORS);
  }

  private parseRelationalExpression(): ParsedExpression {
    return this.parseBinaryExpression(() => this.parseShiftExpression(), RELATIONAL_OPERATORS);
  }

  private parseShiftExpression(): ParsedExpression {
    return this.parseBinaryExpression(() => this.parseAdditiveExpression(), SHIFT_OPERATORS);
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
    if (token.type === "punctuator" && (token.value === "++" || token.value === "--")) {
      this.index += 1;
      const argument = this.parseUnaryExpression();
      const target = this.toUpdateTarget(argument.node);
      return {
        node: {
          type: "UpdateExpression",
          operator: token.value,
          prefix: true,
          argument: target,
          span: createSpan(token.start, argument.node.span.end)
        },
        parenthesized: false
      };
    }

    if (token.type === "keyword" && token.value === "yield") {
      if (this.functionContext !== "generator") {
        throw new Error(
          `yield is only valid inside a generator body at line ${token.start.line}, column ${token.start.column}.`
        );
      }

      this.index += 1;
      if (
        hasLineBreakBetween(token, this.currentToken()) &&
        this.currentToken().type === "punctuator" &&
        this.currentToken().value === "*"
      ) {
        throw unexpectedTokenError(this.currentToken());
      }
      const delegate = this.consumePunctuator("*") !== undefined;
      const next = this.currentToken();
      const hasArgument =
        delegate ||
        (!hasLineBreakBetween(token, next) &&
          !(next.type === "punctuator" && isYieldArgumentTerminator(next.value)) &&
          next.type !== "eof");
      const argument = hasArgument ? this.parseAssignmentExpression().node : undefined;
      if (delegate && argument === undefined) {
        throw unexpectedTokenError(next);
      }
      return {
        node: {
          type: "YieldExpression",
          argument,
          delegate,
          span: createSpan(token.start, argument?.span.end ?? token.end)
        },
        parenthesized: false
      };
    }

    if (token.type === "keyword" && token.value === "await") {
      if (!this.lexicalContext.await) throw new DisallowedSyntaxError("await in a class element", token.start);
      if (this.functionContext === "generator") {
        throw new Error(
          `generators cannot await; use a regular async function at line ${token.start.line}, column ${token.start.column}.`
        );
      }
      if (this.functionContext === "parameters") {
        throw new Error(
          `await is not valid in function parameters at line ${token.start.line}, column ${token.start.column}.`
        );
      }
      this.index += 1;
      const argument = this.parseUnaryExpression();
      return {
        node: {
          type: "AwaitExpression",
          argument: argument.node,
          span: createSpan(token.start, argument.node.span.end)
        },
        parenthesized: false
      };
    }

    if (
      token.type === "keyword" &&
      (token.value === "delete" || token.value === "typeof" || token.value === "void")
    ) {
      this.index += 1;
      const argument = this.parseUnaryExpression();
      return {
        node: {
          type: "UnaryExpression",
          operator: token.value,
          prefix: true,
          argument: argument.node,
          span: createSpan(token.start, argument.node.span.end)
        },
        parenthesized: false
      };
    }

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
          const property = this.parseExpression({ allowSequence: true });
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
        const property = this.parseExpression({ allowSequence: true });
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

      if (this.currentToken().type === "template") {
        const quasi = createTemplateLiteral(
          this.currentToken(),
          {
            allowMalformedEscapes: true,
            functionContext: this.functionContext,
            lexicalContext: this.lexicalContext,
            source: this.source
          },
          this.compilation
        );
        this.index += 1;
        expression = {
          node: {
            type: "TaggedTemplateExpression",
            tag: expression.node,
            quasi,
            span: createSpan(expression.node.span.start, quasi.span.end)
          },
          parenthesized: false
        };
        continue;
      }

      break;
    }

    const token = this.currentToken();
    if (
      token.type === "punctuator" &&
      (token.value === "++" || token.value === "--") &&
      token.start.line === expression.node.span.end.line
    ) {
      this.index += 1;
      const target = this.toUpdateTarget(expression.node);
      return {
        node: {
          type: "UpdateExpression",
          operator: token.value,
          prefix: false,
          argument: target,
          span: createSpan(expression.node.span.start, token.end)
        },
        parenthesized: false
      };
    }

    return expression;
  }

  private parsePrimaryExpression(): ParsedExpression {
    const token = this.currentToken();

    if (token.value === "class") return { node: this.parseClass(false) as ClassExpression, parenthesized: false };
    if (token.value === "super") {
      const next = this.peekToken(1).value;
      if (!(next === "(" ? this.lexicalContext.superCall :
          (next === "." || next === "[") && this.lexicalContext.superProperty))
        throw new DisallowedSyntaxError("super", token.start);
      this.index++;
      return { node: { type: "Super", span: createTokenSpan(token) }, parenthesized: false };
    }
    if (token.value === "arguments" && !this.lexicalContext.arguments)
      throw new DisallowedSyntaxError("arguments in a class element", token.start);

    if (token.type === "keyword" && token.value === "this") {
      this.index += 1;
      return {
        node: {
          type: "ThisExpression",
          span: createTokenSpan(token)
        },
        parenthesized: false
      };
    }

    if (
      (token.type === "keyword" && token.value === "function") ||
      this.isAsyncFunctionDeclarationStart()
    ) {
      return {
        node: this.parseFunctionExpression(),
        parenthesized: false
      };
    }

    if (isNewToken(token)) {
      return this.parseNewExpression();
    }

    if (isIdentifierLikeToken(token)) {
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

    if (token.type === "regex") {
      this.index += 1;
      return {
        node: createRegexLiteral(token, this.compilation),
        parenthesized: false
      };
    }

    if (token.type === "template") {
      this.index += 1;
      return {
        node: createTemplateLiteral(
          token,
          {
            allowMalformedEscapes: false,
            functionContext: this.functionContext,
            lexicalContext: this.lexicalContext,
            source: this.source
          },
          this.compilation
        ),
        parenthesized: false
      };
    }

    if (token.type === "keyword") {
      if (this.isImportMetaStart()) {
        return {
          node: this.parseImportMeta(),
          parenthesized: false
        };
      }

      this.index += 1;
      return {
        node: createKeywordLiteral(token),
        parenthesized: false
      };
    }

    if (token.type === "punctuator" && token.value === "(") {
      const start = this.expectPunctuator("(");
      const expression = this.parseExpression({ allowSequence: true });
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

  private parseNewExpression(): ParsedExpression {
    const newToken = this.currentToken();
    this.index += 1;

    if (this.consumePunctuator(".") !== undefined) {
      const target = this.currentToken();
      if (target.value !== "target" || !this.lexicalContext.newTarget)
        throw new DisallowedSyntaxError(newToken.value, newToken.start);
      this.index++;
      return { node: { type: "NewTargetExpression", span: createSpan(newToken.start, target.end) }, parenthesized: false };
    }

    let callee = this.parsePrimaryExpression();
    while (true) {
      if (this.consumePunctuator(".") !== undefined) {
        const property = this.parseIdentifierName();
        callee = {
          node: {
            type: "MemberExpression",
            computed: false,
            object: callee.node,
            optional: false,
            property,
            span: createSpan(callee.node.span.start, property.span.end)
          },
          parenthesized: false
        };
        continue;
      }

      if (this.consumePunctuator("[") !== undefined) {
        const property = this.parseExpression({ allowSequence: true });
        const end = this.expectPunctuator("]");
        callee = {
          node: {
            type: "MemberExpression",
            computed: true,
            object: callee.node,
            optional: false,
            property: property.node,
            span: createSpan(callee.node.span.start, end.end)
          },
          parenthesized: false
        };
        continue;
      }

      break;
    }

    const optional = this.consumePunctuator("?.");
    if (optional !== undefined)
      throw new DisallowedSyntaxError("new optional chain", optional.start);
    if (callee.node.type === "Super")
      throw new DisallowedSyntaxError("new super", newToken.start);
    const args = this.consumePunctuator("(") === undefined ? [] : this.parseArguments();
    const end = this.previousToken();

    return {
      node: {
        type: "NewExpression",
        arguments: args,
        callee: callee.node,
        span: createSpan(newToken.start, end.end)
      },
      parenthesized: false
    };
  }

  private parseFunctionExpression(): FunctionExpression {
    const asyncToken = this.consumeKeyword("async");
    const functionToken = this.expectKeyword("function");
    const generatorToken = this.consumePunctuator("*");
    if (asyncToken !== undefined && generatorToken !== undefined) {
      throw new Error(
        `async function* is not supported at line ${asyncToken.start.line}, column ${asyncToken.start.column}.`
      );
    }
    const id = isIdentifierLikeToken(this.currentToken())
      ? this.parseBindingIdentifier()
      : undefined;
    const generator = generatorToken !== undefined;
    const { params, body } = this.parseFunctionParts(generator, ordinaryFunctionContext);

    return this.withFunctionSource({
      type: "FunctionExpression",
      async: asyncToken !== undefined,
      body,
      generator,
      id,
      params,
      span: createSpan(asyncToken?.start ?? functionToken.start, body.span.end)
    });
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
      if (this.consumePunctuator(",") !== undefined) {
        const comma = this.previousToken();
        elements.push({
          type: "UndefinedLiteral",
          raw: "undefined",
          value: undefined,
          elision: true,
          span: createSpan(comma.start, comma.end)
        });
        if (this.currentToken().type === "punctuator" && this.currentToken().value === "]") {
          break;
        }
        continue;
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
    const generatorToken =
      this.currentToken().type === "punctuator" && this.currentToken().value === "*"
        ? this.currentToken()
        : this.currentToken().type === "keyword" &&
            this.currentToken().value === "async" &&
            this.peekToken(1).type === "punctuator" &&
            this.peekToken(1).value === "*"
          ? this.peekToken(1)
          : undefined;
    if (generatorToken !== undefined && this.currentToken().value !== "*") {
      throw new Error(
        `Generator shorthand methods are not supported at line ${generatorToken.start.line}, column ${generatorToken.start.column}.`
      );
    }
    if (generatorToken !== undefined) this.index++;

    let accessor: "get" | "set" | undefined;
    let accessorStart: Position | undefined;
    if (
      generatorToken === undefined &&
      this.currentToken().type === "identifier" &&
      (this.currentToken().value === "get" || this.currentToken().value === "set") &&
      this.isObjectMethodStart()
    ) {
      const token = this.currentToken();
      if (token.end.offset - token.start.offset !== token.value.length)
        throw unexpectedTokenError(token);
      accessor = token.value === "get" ? "get" : "set";
      accessorStart = token.start;
      this.index++;
    }

    const modifierToken = this.currentToken();
    const asyncToken =
      generatorToken === undefined &&
      modifierToken.type === "keyword" &&
      modifierToken.value === "async" &&
      modifierToken.end.offset - modifierToken.start.offset === modifierToken.value.length &&
      this.isObjectMethodStart() &&
      !hasLineBreakBetween(modifierToken, this.peekToken(1))
        ? modifierToken
        : undefined;
    if (asyncToken !== undefined) {
      this.index += 1;
    }

    if (this.consumePunctuator("[") !== undefined) {
      const propertyStart = this.previousToken();
      const key = this.parseExpression();
      this.expectPunctuator("]");
      if (this.currentToken().type === "punctuator" && this.currentToken().value === "(") {
        const value = this.parseObjectMethod(asyncToken, accessorStart ?? propertyStart.start, accessor, generatorToken);
        return {
          type: "Property",
          ...(accessor === undefined ? {} : { kind: accessor }),
          computed: true,
          shorthand: false,
          key: key.node,
          value,
          span: createSpan(value.span.start, value.span.end)
        };
      }
      if (generatorToken !== undefined) throw unexpectedTokenError(this.currentToken());
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
    if (token.type === "identifier" || token.type === "keyword") {
      this.index += 1;
      const key = createIdentifierName(token);
      if (this.currentToken().type === "punctuator" && this.currentToken().value === "(") {
        const value = this.parseObjectMethod(asyncToken, accessorStart ?? key.span.start, accessor, generatorToken);
        return {
          type: "Property",
          ...(accessor === undefined ? {} : { kind: accessor }),
          computed: false,
          shorthand: false,
          key,
          value,
          span: createSpan(value.span.start, value.span.end)
        };
      }
      if (generatorToken !== undefined) throw unexpectedTokenError(this.currentToken());
      if (this.consumePunctuator(":") === undefined) {
        if (!isIdentifierLikeToken(token)) throw unexpectedTokenError(token);
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
      if (this.currentToken().type === "punctuator" && this.currentToken().value === "(") {
        const value = this.parseObjectMethod(asyncToken, accessorStart ?? key.span.start, accessor, generatorToken);
        return {
          type: "Property",
          ...(accessor === undefined ? {} : { kind: accessor }),
          computed: false,
          shorthand: false,
          key,
          value,
          span: createSpan(value.span.start, value.span.end)
        };
      }
      if (generatorToken !== undefined) throw unexpectedTokenError(this.currentToken());
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

  private isObjectMethodStart(): boolean {
    const propertyToken = this.peekToken(1);
    if (propertyToken.type === "punctuator" && propertyToken.value === "[") {
      let depth = 0;
      let offset = 1;
      while (true) {
        const token = this.peekToken(offset);
        if (token.type === "eof") {
          return false;
        }
        if (token.type === "punctuator" && token.value === "[") {
          depth += 1;
        } else if (token.type === "punctuator" && token.value === "]") {
          depth -= 1;
          if (depth === 0) {
            const next = this.peekToken(offset + 1);
            return next.type === "punctuator" && next.value === "(";
          }
        }
        offset += 1;
      }
    }
    return (
      (propertyToken.type === "identifier" ||
        propertyToken.type === "keyword" ||
        propertyToken.type === "numeric" ||
        propertyToken.type === "string") &&
      this.peekToken(2).type === "punctuator" &&
      this.peekToken(2).value === "("
    );
  }

  private parseObjectMethod(
    asyncToken: Token | undefined,
    methodStart: Position,
    accessor?: "get" | "set",
    generatorToken?: Token
  ): FunctionExpression {
    const { params, body } = this.parseFunctionParts(generatorToken !== undefined, {
      ...ordinaryFunctionContext,
      superProperty: true,
      ...(accessor === undefined ? {} : { await: false, strictAwait: true })
    }, accessor);

    return this.withFunctionSource({
      type: "FunctionExpression",
      async: asyncToken !== undefined,
      body,
      generator: generatorToken !== undefined,
      id: undefined,
      method: true,
      params,
      span: createSpan(asyncToken?.start ?? generatorToken?.start ?? methodStart, body.span.end)
    });
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

  private toAssignmentTarget(node: Expression): AssignmentTarget {
    if (node.type === "Identifier") {
      return node;
    }

    if (node.type === "MetaProperty" || (node.type === "MemberExpression" && !node.optional)) {
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

  private toUpdateTarget(node: Expression): UpdateTarget {
    if (node.type === "Identifier") {
      return node;
    }

    if (node.type === "MemberExpression" && !node.optional) {
      return node;
    }

    throw new Error(
      `Invalid update target at line ${node.span.start.line}, column ${node.span.start.column}.`
    );
  }

  private arrayExpressionToPattern(node: ArrayExpression): ArrayPattern {
    const elements = node.elements.map((element, index) => {
      if (element.type === "UndefinedLiteral" && element.elision === true) {
        return null;
      }
      const patternElement = this.toArrayPatternElement(element);
      if (patternElement.type === "RestElement" && index < node.elements.length - 1) {
        const nextElement = node.elements[index + 1]!;
        throw new Error(
          `Rest element must be the last element in an array pattern at line ${nextElement.span.start.line}, column ${nextElement.span.start.column}.`
        );
      }
      return patternElement;
    });

    return {
      type: "ArrayPattern",
      elements,
      span: node.span
    };
  }

  private toArrayPatternElement(
    element: Expression | SpreadElement
  ):
    | AssignmentPattern
    | ArrayPattern
    | Identifier
    | MemberExpression
    | ObjectPattern
    | RestElement {
    if (element.type === "SpreadElement") {
      const argument = this.toPatternTarget(this.toAssignmentTarget(element.argument));
      return {
        type: "RestElement",
        argument,
        span: element.span
      };
    }

    if (element.type === "AssignmentExpression" && element.operator === "=") {
      return {
        type: "AssignmentPattern",
        left: this.toPatternTarget(element.left),
        right: element.right,
        span: element.span
      };
    }

    return this.toPatternTarget(this.toAssignmentTarget(element));
  }

  private objectExpressionToPattern(node: ObjectExpression): ObjectPattern {
    const properties: ObjectPattern["properties"] = [];
    let restElement: RestElement | undefined;

    for (const property of node.properties) {
      const patternProperty = this.toObjectPatternProperty(property);
      if (patternProperty.type === "RestElement") {
        if (restElement !== undefined) {
          throw new Error(
            `Object pattern can contain only one rest element at line ${patternProperty.span.start.line}, column ${patternProperty.span.start.column}.`
          );
        }
        restElement = patternProperty;
      } else if (restElement !== undefined) {
        throw new Error(
          `Rest element must be the last property in an object pattern at line ${patternProperty.span.start.line}, column ${patternProperty.span.start.column}.`
        );
      }
      properties.push(patternProperty);
    }

    return {
      type: "ObjectPattern",
      properties,
      span: node.span
    };
  }

  private toObjectPatternProperty(
    property: Property | SpreadElement
  ): AssignmentProperty | RestElement {
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
        left: this.toPatternTarget(value.left),
        right: value.right,
        span: value.span
      };
    }

    return this.toPatternTarget(this.toAssignmentTarget(value));
  }

  private isPatternAssignmentStart(startIndex: number): boolean {
    const startToken = this.tokens[startIndex];
    if (
      startToken?.type !== "punctuator" ||
      (startToken.value !== "[" && startToken.value !== "{")
    ) {
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
          return (
            this.tokens[index + 1]?.type === "punctuator" && this.tokens[index + 1]?.value === "="
          );
        }
      }
    }

    return false;
  }

  private isSingleParamArrowFunction(): boolean {
    const token = this.currentToken();
    if (!isIdentifierLikeToken(token) || this.peekToken(1).value !== "=>") {
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
    if (this.isAsyncFunctionDeclarationStart()) {
      return true;
    }
    if (token.type === "keyword" && TOP_LEVEL_STATEMENT_KEYWORDS.has(token.value)) {
      if (token.value === "import" && this.isImportMetaStart()) {
        return false;
      }
      return true;
    }

    return (
      token.type === "identifier" &&
      (token.value === "switch" ||
        token.value === "var" ||
        (this.peekToken(1).type === "punctuator" && this.peekToken(1).value === ":"))
    );
  }

  private isAsyncFunctionDeclarationStart(): boolean {
    const token = this.currentToken();
    const next = this.peekToken(1);
    return (
      token.type === "keyword" &&
      token.value === "async" &&
      next.type === "keyword" &&
      next.value === "function" &&
      !hasLineBreakBetween(token, next)
    );
  }

  private assertAllowedStatementStart(token: Token): void {
    if (this.isExportToken(token)) {
      throw new DisallowedSyntaxError("export", token.start);
    }

    if (
      token.type === "identifier" &&
      this.peekToken(1).type === "punctuator" &&
      this.peekToken(1).value === ":"
    ) {
      throw new DisallowedSyntaxError("label", token.start);
    }
  }

  private consumeControlLabel(token: Token): Token | undefined {
    if (
      this.currentToken().type === "identifier" &&
      !hasLineBreakBetween(token, this.currentToken())
    ) {
      const label = this.currentToken();
      this.index += 1;
      return label;
    }

    return undefined;
  }

  private hasReturnArgument(returnToken: Token, nextToken: Token): boolean {
    return !(
      hasLineBreakBetween(returnToken, nextToken) ||
      (nextToken.type === "punctuator" && (nextToken.value === ";" || nextToken.value === "}")) ||
      nextToken.type === "eof"
    );
  }

  private withFunctionContext<T>(functionContext: FunctionParseContext, callback: () => T): T {
    const previousBreakableDepth = this.breakableDepth;
    const previousLoopDepth = this.loopDepth;
    const previousFunctionContext = this.functionContext;
    this.breakableDepth = 0;
    this.loopDepth = 0;
    this.functionContext = functionContext;
    try {
      return callback();
    } finally {
      this.breakableDepth = previousBreakableDepth;
      this.loopDepth = previousLoopDepth;
      this.functionContext = previousFunctionContext;
    }
  }

  private withLexicalContext<T>(context: LexicalParseContext, callback: () => T): T {
    const previous = this.lexicalContext;
    this.lexicalContext = context;
    try { return callback(); } finally { this.lexicalContext = previous; }
  }

  private withLoopContext<T>(callback: () => T): T {
    this.breakableDepth += 1;
    this.loopDepth += 1;
    try {
      return callback();
    } finally {
      this.breakableDepth -= 1;
      this.loopDepth -= 1;
    }
  }

  private withBreakableContext<T>(callback: () => T): T {
    this.breakableDepth += 1;
    try {
      return callback();
    } finally {
      this.breakableDepth -= 1;
    }
  }

  private withScope<T>(callback: () => T, functionBody = false): T {
    const scope: ParserScope = new Map();
    if (functionBody) this.functionScopes.add(scope);
    this.scopes.push(scope);
    try {
      return callback();
    } finally {
      this.scopes.pop();
    }
  }

  private declarePatternBindings(pattern: ArrayPattern | Identifier | ObjectPattern): void {
    for (const identifier of boundIdentifiers(pattern)) {
      this.declareBinding(identifier);
    }
  }

  private declareBinding(identifier: Identifier, kind: ParserBindingKind = "lexical"): void {
    const scope = this.scopes[this.scopes.length - 1];
    if (scope === undefined) {
      return;
    }

    const existing = scope.get(identifier.name);
    const variableFunction = kind === "function" && this.functionScopes.has(scope);
    if (
      (existing !== undefined &&
        !(variableFunction && (existing === "function" || existing === "parameter"))) ||
      (!variableFunction && this.varNames.get(scope)?.has(identifier.name))
    ) {
      throw new Error(
        `Cannot redeclare binding '${identifier.name}' at line ${identifier.span.start.line}, column ${identifier.span.start.column}.`
      );
    }

    scope.set(identifier.name, kind);
  }

  private declareVarBinding(identifier: Identifier): void {
    for (let index = this.scopes.length - 1; index >= 0; index--) {
      const scope = this.scopes[index]!;
      const existing = scope.get(identifier.name);
      if (existing === "lexical" || (existing === "function" && !this.functionScopes.has(scope))) {
        throw new Error(
          `Cannot redeclare binding '${identifier.name}' at line ${identifier.span.start.line}, column ${identifier.span.start.column}.`
        );
      }
      let names = this.varNames.get(scope);
      if (names === undefined) {
        names = new Set();
        this.varNames.set(scope, names);
      }
      names.add(identifier.name);
      if (this.functionScopes.has(scope)) return;
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

  private consumeAssignmentOperator(): AssignmentOperator | undefined {
    const token = this.currentToken();
    if (token.type !== "punctuator" || !isAssignmentOperator(token.value)) {
      return undefined;
    }

    this.index += 1;
    return token.value;
  }

  private expectPunctuator(value: string): Token {
    const token = this.currentToken();
    if (token.type !== "punctuator" || token.value !== value) {
      throw new Error(
        `Expected '${value}' at line ${token.start.line}, column ${token.start.column}.`
      );
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
      throw new Error(
        `Expected '${value}' at line ${token.start.line}, column ${token.start.column}.`
      );
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

  private isExportToken(token: Token): boolean {
    return token.value === "export";
  }

  private isImportMetaStart(): boolean {
    return isImportMetaTokenSequence(this.currentToken(), this.peekToken(1), this.peekToken(2));
  }

  private parseImportMeta(): MetaProperty {
    const importToken = this.currentToken();
    if (!this.isImportMetaStart()) {
      throw unexpectedTokenError(importToken);
    }

    this.index += 3;
    return createImportMeta(importToken, this.previousToken());
  }

  private toPatternTarget(target: AssignmentTarget): PatternTarget {
    if (target.type === "MetaProperty") {
      throw new DisallowedSyntaxError("import.meta assignment", target.span.start);
    }

    return target;
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

function createLoopLabelFields(labels: string[] | undefined): {
  label?: string;
  labels?: string[];
} {
  if (labels === undefined || labels.length === 0) {
    return {};
  }

  const label = labels[labels.length - 1]!;
  return labels.length === 1 ? { label } : { label, labels };
}

function throwIfImportMetaAssignment(node: ParseResult | Module): void {
  const importMetaAssignment = findImportMetaAssignmentTarget(node);
  if (importMetaAssignment !== undefined) {
    throw new DisallowedSyntaxError("import.meta assignment", importMetaAssignment.start);
  }
}

function findImportMetaAssignmentTarget(node: ParseResult | Module): SourceSpan | undefined {
  return findImportMetaAssignmentInNode(node);
}

function findImportMetaAssignmentInNode(
  node: Expression | Statement | Module
): SourceSpan | undefined {
  switch (node.type) {
    case "Module":
      return findImportMetaAssignmentInList(node.body);
    case "AssignmentExpression":
      if (isImportMetaAssignmentTarget(node.left)) {
        return node.left.span;
      }
      return findImportMetaAssignmentInNode(node.right);
    case "ForOfStatement":
      if (node.left.type !== "VariableDeclaration" && isImportMetaAssignmentTarget(node.left)) {
        return node.left.span;
      }
      return (
        findImportMetaAssignmentInNode(node.right) ?? findImportMetaAssignmentInNode(node.body)
      );
    case "BlockStatement":
      return findImportMetaAssignmentInList(node.body);
    case "ExpressionStatement":
      return findImportMetaAssignmentInNode(node.expression);
    case "IfStatement":
      return (
        findImportMetaAssignmentInNode(node.test) ??
        findImportMetaAssignmentInNode(node.consequent) ??
        (node.alternate === undefined ? undefined : findImportMetaAssignmentInNode(node.alternate))
      );
    case "ForStatement":
      return (
        findImportMetaAssignmentInOptionalForInit(node.init) ??
        findImportMetaAssignmentInOptionalExpression(node.test) ??
        findImportMetaAssignmentInOptionalExpression(node.update) ??
        findImportMetaAssignmentInNode(node.body)
      );
    case "WhileStatement":
      return findImportMetaAssignmentInNode(node.test) ?? findImportMetaAssignmentInNode(node.body);
    case "DoWhileStatement":
      return findImportMetaAssignmentInNode(node.body) ?? findImportMetaAssignmentInNode(node.test);
    case "TryStatement":
      return (
        findImportMetaAssignmentInNode(node.block) ??
        (node.handler === undefined
          ? undefined
          : findImportMetaAssignmentInNode(node.handler.body)) ??
        (node.finalizer === undefined ? undefined : findImportMetaAssignmentInNode(node.finalizer))
      );
    case "VariableDeclaration":
      for (const declarator of node.declarations) {
        if (declarator.init !== undefined) {
          const result = findImportMetaAssignmentInNode(declarator.init);
          if (result !== undefined) {
            return result;
          }
        }
      }
      return undefined;
    case "ReturnStatement":
      return node.argument === undefined
        ? undefined
        : findImportMetaAssignmentInNode(node.argument);
    case "ThrowStatement":
      return findImportMetaAssignmentInNode(node.argument);
    case "ArrowFunctionExpression":
      return node.body.type === "BlockStatement"
        ? findImportMetaAssignmentInNode(node.body)
        : findImportMetaAssignmentInNode(node.body);
    case "AwaitExpression":
      return findImportMetaAssignmentInNode(node.argument);
    case "YieldExpression":
      return node.argument === undefined
        ? undefined
        : findImportMetaAssignmentInNode(node.argument);
    case "ArrayExpression":
      return findImportMetaAssignmentInList(node.elements);
    case "ObjectExpression":
      for (const property of node.properties) {
        const result =
          property.type === "SpreadElement"
            ? findImportMetaAssignmentInNode(property.argument)
            : findImportMetaAssignmentInNode(property.value);
        if (result !== undefined) {
          return result;
        }
      }
      return undefined;
    case "UnaryExpression":
      return findImportMetaAssignmentInNode(node.argument);
    case "UpdateExpression":
      if (isImportMetaReference(node.argument)) {
        return node.argument.span;
      }
      return findImportMetaAssignmentInNode(node.argument);
    case "SequenceExpression":
      return findImportMetaAssignmentInList(node.expressions);
    case "BinaryExpression":
    case "LogicalExpression":
      return (
        findImportMetaAssignmentInNode(node.left) ?? findImportMetaAssignmentInNode(node.right)
      );
    case "ConditionalExpression":
      return (
        findImportMetaAssignmentInNode(node.test) ??
        findImportMetaAssignmentInNode(node.consequent) ??
        findImportMetaAssignmentInNode(node.alternate)
      );
    case "MemberExpression":
      return (
        findImportMetaAssignmentInNode(node.object) ??
        (node.computed ? findImportMetaAssignmentInNode(node.property) : undefined)
      );
    case "CallExpression":
      return (
        findImportMetaAssignmentInNode(node.callee) ??
        findImportMetaAssignmentInList(node.arguments)
      );
    case "TaggedTemplateExpression":
      return findImportMetaAssignmentInNode(node.tag) ?? findImportMetaAssignmentInNode(node.quasi);
    case "TemplateLiteral":
      return findImportMetaAssignmentInList(node.expressions);
    case "BreakStatement":
    case "ContinueStatement":
    case "EmptyStatement":
    case "ExportDefaultDeclaration":
    case "ExportNamedDeclaration":
    case "Identifier":
    case "ImportDeclaration":
    case "BooleanLiteral":
    case "NullLiteral":
    case "NumericLiteral":
    case "StringLiteral":
    case "ThisExpression":
    case "RegexLiteral":
    case "MetaProperty":
    case "UndefinedLiteral":
      return undefined;
  }
}

function findImportMetaAssignmentInOptionalForInit(
  node: Expression | VariableDeclaration | undefined
): SourceSpan | undefined {
  return node === undefined ? undefined : findImportMetaAssignmentInNode(node);
}

function findImportMetaAssignmentInOptionalExpression(
  node: Expression | undefined
): SourceSpan | undefined {
  return node === undefined ? undefined : findImportMetaAssignmentInNode(node);
}

function findImportMetaAssignmentInList(
  nodes: ReadonlyArray<Expression | SpreadElement | Statement>
): SourceSpan | undefined {
  for (const node of nodes) {
    const result =
      node.type === "SpreadElement"
        ? findImportMetaAssignmentInNode(node.argument)
        : findImportMetaAssignmentInNode(node);
    if (result !== undefined) {
      return result;
    }
  }

  return undefined;
}

function isImportMetaAssignmentTarget(
  node: AssignmentExpression["left"] | AssignmentPattern | RestElement
): boolean {
  switch (node.type) {
    case "MetaProperty":
      return true;
    case "MemberExpression":
      return isImportMetaReference(node);
    case "AssignmentPattern":
      return isImportMetaAssignmentTarget(node.left);
    case "RestElement":
      return isImportMetaAssignmentTarget(node.argument);
    case "ArrayPattern":
      return node.elements.some(
        (element) => element !== null && isImportMetaAssignmentTarget(element)
      );
    case "ObjectPattern":
      return node.properties.some((property) =>
        isImportMetaAssignmentTarget(property.type === "RestElement" ? property : property.value)
      );
    case "Identifier":
      return false;
  }
}

function isImportMetaReference(node: Expression): boolean {
  if (node.type === "MetaProperty") {
    return true;
  }

  return (
    node.type === "MemberExpression" &&
    (isImportMetaReference(node.object) || (node.computed && isImportMetaReference(node.property)))
  );
}

function isAssignmentOperator(value: string): value is AssignmentOperator {
  switch (value) {
    case "=":
    case "+=":
    case "-=":
    case "*=":
    case "/=":
    case "%=":
    case "**=":
    case "&=":
    case "|=":
    case "^=":
    case "<<=":
    case ">>=":
    case ">>>=":
    case "&&=":
    case "||=":
    case "??=":
      return true;
    default:
      return false;
  }
}

function isYieldArgumentTerminator(value: string): boolean {
  return value === ";" || value === "}" || value === ")" || value === "]" || value === ",";
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

function createRegexLiteral(token: Token, parent?: CompileScope): RegexLiteral {
  const compilation = new CompileScope(parent?.owner);
  const guard = new RegexCompileGuard(compilation);
  const lastSlash = token.value.lastIndexOf("/");
  try {
    guard.checkLength(Math.max(0, lastSlash - 1));
    guard.checkLength(token.value.length - lastSlash - 1, true);
    guard.allocate(Math.max(0, token.value.length - 2));
    guard.work(Math.max(0, token.value.length - 2));
    parseRegex(token.value.slice(1, lastSlash), token.value.slice(lastSlash + 1), compilation);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const relativePosition = readRegexErrorPosition(error.message);
      if (relativePosition !== undefined) {
        const flagColumn = token.start.column + lastSlash + 1 + relativePosition;
        throw new Error(
          `${error.message.replace(/ at position \d+$/, "")} at line ${token.start.line}, column ${flagColumn}.`
        );
      }
    }
    throw error;
  } finally {
    guard.close();
    compilation.dispose();
  }
  return {
    type: "RegexLiteral",
    raw: token.value,
    span: createTokenSpan(token)
  };
}

function readRegexErrorPosition(message: string): number | undefined {
  const marker = " at position ";
  const markerIndex = message.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const position = Number(message.slice(markerIndex + marker.length));
  return Number.isSafeInteger(position) && position >= 0 ? position : undefined;
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

function createTemplateLiteral(
  token: Token,
  options: {
    allowMalformedEscapes: boolean;
    functionContext: FunctionParseContext;
    lexicalContext: LexicalParseContext;
    source: string;
  },
  compilation?: CompileScope
): TemplateLiteral {
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
      quasis.push(createTemplateElement(token.start, raw, quasiStart, cursor, false, options));
      const expressionStart = cursor + 2;
      const expressionEnd = findTemplateExpressionEnd(raw, expressionStart);
      expressions.push(
        parseEmbeddedExpression(
          raw.slice(expressionStart, expressionEnd),
          positionWithinRaw(token.start, raw, expressionStart),
          options.functionContext,
          options.lexicalContext,
          options.source,
          compilation
        )
      );
      quasiStart = expressionEnd + 1;
      cursor = expressionEnd + 1;
      continue;
    }

    cursor += 1;
  }

  quasis.push(createTemplateElement(token.start, raw, quasiStart, raw.length - 1, true, options));

  return {
    type: "TemplateLiteral",
    expressions,
    quasis,
    span: createTokenSpan(token)
  };
}

function assertBareImportSpecifier(specifier: StringLiteral): void {
  if (
    specifier.value.includes("/") ||
    hasInvalidImportPathDots(specifier.value) ||
    hasProtocolPrefix(specifier.value)
  ) {
    throw new Error(
      `Invalid import specifier '${specifier.value}' at line ${specifier.span.start.line}, column ${specifier.span.start.column}.`
    );
  }
}

function hasInvalidImportPathDots(value: string): boolean {
  const segments = value.split(".");

  if (segments.some((segment) => segment.length === 0)) {
    return true;
  }

  return (
    segments.length > 1 &&
    ["js", "mjs", "cjs", "ts", "mts", "cts", "json"].includes(segments.at(-1) ?? "")
  );
}

function hasProtocolPrefix(value: string): boolean {
  const colonIndex = value.indexOf(":");
  if (colonIndex <= 0) {
    return false;
  }

  const firstChar = value[0];
  if (firstChar === undefined || !isAsciiLetter(firstChar)) {
    return false;
  }

  for (let index = 1; index < colonIndex; index += 1) {
    const char = value[index];
    if (char === undefined) {
      return false;
    }
    if (
      isAsciiLetter(char) ||
      isDecimalDigit(char) ||
      char === "+" ||
      char === "-" ||
      char === "."
    ) {
      continue;
    }
    return false;
  }

  return true;
}

function isAsciiLetter(value: string): boolean {
  const code = value.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDecimalDigit(value: string): boolean {
  const code = value.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isHexDigit(value: string): boolean {
  return isDecimalDigit(value) || (value >= "a" && value <= "f") || (value >= "A" && value <= "F");
}

function isOctalDigit(value: string): boolean {
  return value >= "0" && value <= "7";
}

function createTemplateElement(
  templateStart: Position,
  rawTemplate: string,
  rawStart: number,
  rawEnd: number,
  tail: boolean,
  options: { allowMalformedEscapes: boolean }
): TemplateElement {
  const rawValue = rawTemplate.slice(rawStart, rawEnd);
  const cooked = decodeTemplateElementCooked(rawValue, options.allowMalformedEscapes);
  if (cooked.invalid !== undefined && !options.allowMalformedEscapes) {
    const position = positionWithinRaw(templateStart, rawTemplate, rawStart + cooked.invalid.index);
    throw new Error(
      `${cooked.invalid.message} at line ${position.line}, column ${position.column}.`
    );
  }

  return {
    type: "TemplateElement",
    tail,
    value: {
      raw: rawValue,
      cooked: cooked.invalid === undefined ? cooked.value : undefined
    },
    span: createSpan(
      positionWithinRaw(templateStart, rawTemplate, rawStart),
      positionWithinRaw(templateStart, rawTemplate, rawEnd)
    )
  };
}

function decodeTemplateElementCooked(
  value: string,
  allowMalformedEscapes: boolean
): { invalid?: { index: number; message: string }; value?: string } {
  const normalized = normalizeTemplateLineTerminators(value);
  const invalid = findMalformedTemplateEscape(normalized);
  if (invalid !== undefined) {
    return allowMalformedEscapes ? { invalid } : { invalid };
  }

  return {
    value: decodeEscapedText(normalized)
  };
}

function findMalformedTemplateEscape(
  value: string
): { index: number; message: string } | undefined {
  let index = 0;

  while (index < value.length) {
    if (value[index] !== "\\") {
      index += 1;
      continue;
    }

    const next = value[index + 1];
    if (next === undefined || next === "\n") {
      index += 2;
      continue;
    }

    if (next === "u") {
      if (!isValidUnicodeEscape(value, index)) {
        return { index, message: "Invalid unicode escape" };
      }
      index += 2;
      continue;
    }

    if (next === "x") {
      const hex = value.slice(index + 2, index + 4);
      if (hex.length !== 2 || ![...hex].every(isHexDigit)) {
        return { index, message: "Invalid hex escape" };
      }
      index += 4;
      continue;
    }

    if (next === "0") {
      if (isDecimalDigit(value[index + 2] ?? "")) {
        return { index, message: "Legacy octal escape sequences are not supported" };
      }
      index += 2;
      continue;
    }

    if (isOctalDigit(next)) {
      return { index, message: "Legacy octal escape sequences are not supported" };
    }

    index += 2;
  }

  return undefined;
}

function isValidUnicodeEscape(value: string, start: number): boolean {
  let index = start + 2;
  if (value[index] === "{") {
    index += 1;
    const codePointStart = index;
    while (index < value.length && value[index] !== "}") {
      if (!isHexDigit(value[index] ?? "")) {
        return false;
      }
      index += 1;
    }

    if (index === codePointStart || value[index] !== "}") {
      return false;
    }

    return Number.parseInt(value.slice(codePointStart, index), 16) <= MAX_UNICODE_CODE_POINT;
  }

  const hex = value.slice(index, index + 4);
  return hex.length === 4 && [...hex].every(isHexDigit);
}

function findTemplateExpressionEnd(raw: string, start: number): number {
  let depth = 1;
  let index = start;

  while (index < raw.length - 1) {
    const char = raw[index];

    if (char === "'" || char === '"') {
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

    if (next === "u") {
      const unicodeEscape = decodeUnicodeEscape(value, index);
      if (unicodeEscape !== undefined) {
        decoded += unicodeEscape.value;
        index = unicodeEscape.end;
        continue;
      }
    }

    if (next === "x") {
      const hexEscape = decodeHexEscape(value, index);
      if (hexEscape !== undefined) {
        decoded += hexEscape.value;
        index = hexEscape.end;
        continue;
      }
    }

    decoded += decodeEscapeCharacter(next);
    index += 2;
  }

  return decoded;
}

function normalizeTemplateLineTerminators(value: string): string {
  let normalized = "";
  let index = 0;

  while (index < value.length) {
    const char = value[index];
    if (char === "\r") {
      normalized += "\n";
      index += value[index + 1] === "\n" ? 2 : 1;
      continue;
    }

    normalized += char;
    index += 1;
  }

  return normalized;
}

function decodeUnicodeEscape(
  value: string,
  start: number
): { value: string; end: number } | undefined {
  let index = start + 2;
  if (value[index] === "{") {
    index += 1;
    const codePointStart = index;
    while (index < value.length && value[index] !== "}") {
      if (!isHexDigit(value[index] ?? "")) {
        return undefined;
      }
      index += 1;
    }

    if (index === codePointStart || value[index] !== "}") {
      return undefined;
    }

    return {
      value: String.fromCodePoint(Number.parseInt(value.slice(codePointStart, index), 16)),
      end: index + 1
    };
  }

  const hex = value.slice(index, index + 4);
  if (hex.length !== 4 || ![...hex].every(isHexDigit)) {
    return undefined;
  }

  return {
    value: String.fromCharCode(Number.parseInt(hex, 16)),
    end: index + 4
  };
}

function decodeHexEscape(value: string, start: number): { value: string; end: number } | undefined {
  const index = start + 2;
  const hex = value.slice(index, index + 2);
  if (hex.length !== 2 || ![...hex].every(isHexDigit)) {
    return undefined;
  }

  return {
    value: String.fromCharCode(Number.parseInt(hex, 16)),
    end: index + 2
  };
}

function parseEmbeddedExpression(
  source: string,
  base: Position,
  functionContext: FunctionParseContext,
  lexicalContext: LexicalParseContext,
  fullSource: string,
  compilation?: CompileScope
): Expression {
  const tokens = tokenize(source, { allowRegexLiterals: true, compilation }).map((token) => ({
    ...token,
    start: rebasePosition(token.start, base),
    end: rebasePosition(token.end, base)
  }));
  return new Parser(tokens, fullSource, compilation, functionContext, lexicalContext).parseExpressionOnly();
}

export function findRegexLiteral(node: unknown): RegexLiteral | undefined {
  if (node === null || node === undefined) {
    return undefined;
  }

  if (Array.isArray(node)) {
    for (const value of node) {
      const match = findRegexLiteral(value);
      if (match !== undefined) {
        return match;
      }
    }
    return undefined;
  }

  if (typeof node !== "object") {
    return undefined;
  }

  if ("type" in node && node.type === "RegexLiteral") {
    return node as RegexLiteral;
  }

  for (const value of Object.values(node)) {
    const match = findRegexLiteral(value);
    if (match !== undefined) {
      return match;
    }
  }

  return undefined;
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
  return token.type === "numeric" || token.type === "string";
}

function isIdentifierLikeToken(token: Token): boolean {
  return token.type === "identifier" || (token.type === "keyword" && token.value === "async");
}

function isNewToken(token: Token): boolean {
  return token.value === "new";
}

function createTokenSpan(token: Token): SourceSpan {
  return createSpan(token.start, token.end);
}

function assertAllowedIdentifierReference(token: Token): void {
  if (token.value === "new") {
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
    return new Error(
      `Unexpected end of input at line ${token.start.line}, column ${token.start.column}.`
    );
  }

  return new Error(
    `Unexpected token '${token.value}' at line ${token.start.line}, column ${token.start.column}.`
  );
}

function invalidAssignmentTargetError(position: Position): Error {
  return new Error(
    `Invalid assignment target at line ${position.line}, column ${position.column}.`
  );
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
