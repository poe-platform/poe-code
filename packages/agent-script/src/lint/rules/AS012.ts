import {
  parseModule,
  type ArrayExpression,
  type ArrowFunctionExpression,
  type AssignmentExpression,
  type AssignmentPattern,
  type BinaryExpression,
  type CatchClause,
  type CallExpression,
  type ConditionalExpression,
  type DoWhileStatement,
  type Expression,
  type ForInStatement,
  type ForOfStatement,
  type ForStatement,
  type IfStatement,
  type LogicalExpression,
  type MemberExpression,
  type Module,
  type ObjectExpression,
  type Property,
  type ReturnStatement,
  type RestElement,
  type SourceSpan,
  type SpreadElement,
  type Statement,
  type TemplateLiteral,
  type ThrowStatement,
  type TryStatement,
  type UnaryExpression,
  type VariableDeclaration,
  type VariableDeclarator,
  type WhileStatement
} from "../../parse/parser.js";

export type Diagnostic = {
  code: "AS012";
  severity: "error";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

const SORT_MESSAGE = "Array#sort only supports comparators that are arrows returning a number.";
const NUMBER_RETURNING_BINARY_OPERATORS = new Set([
  "%",
  "*",
  "**",
  "-",
  "/",
  "<<",
  ">>",
  ">>>",
  "&",
  "^",
  "|"
]);

export function AS012(source: string, options: { filename?: string } = {}): Diagnostic[] {
  return new AS012Scanner(options.filename ?? "<input>").scan(source);
}

class AS012Scanner {
  private readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly filename: string) {}

  scan(source: string): Diagnostic[] {
    this.visitModule(parseModule(source, this.filename));
    return this.diagnostics;
  }

  private visitModule(node: Module): void {
    for (const statement of node.body) {
      this.visitStatement(statement);
    }
  }

  private visitStatement(node: Statement): void {
    switch (node.type) {
      case "BlockStatement":
        for (const statement of node.body) {
          this.visitStatement(statement);
        }
        return;
      case "ExpressionStatement":
        this.visitExpression(node.expression);
        return;
      case "IfStatement":
        this.visitIfStatement(node);
        return;
      case "ForStatement":
        this.visitForStatement(node);
        return;
      case "ForInStatement":
      case "ForOfStatement":
        this.visitForOfStatement(node);
        return;
      case "WhileStatement":
      case "DoWhileStatement":
        this.visitWhileStatement(node);
        return;
      case "TryStatement":
        this.visitTryStatement(node);
        return;
      case "VariableDeclaration":
        this.visitVariableDeclaration(node);
        return;
      case "ReturnStatement":
        this.visitReturnStatement(node);
        return;
      case "ThrowStatement":
        this.visitThrowStatement(node);
        return;
      case "ExportNamedDeclaration":
        this.visitVariableDeclaration(node.declaration);
        return;
      case "ExportDefaultDeclaration":
        this.visitExpression(node.declaration);
        return;
      case "ImportDeclaration":
      case "BreakStatement":
      case "ContinueStatement":
        return;
    }
  }

  private visitIfStatement(node: IfStatement): void {
    this.visitExpression(node.test);
    this.visitStatement(node.consequent);
    if (node.alternate !== undefined) {
      this.visitStatement(node.alternate);
    }
  }

  private visitForStatement(node: ForStatement): void {
    if (node.init !== undefined) {
      if (node.init.type === "VariableDeclaration") {
        this.visitVariableDeclaration(node.init);
      } else {
        this.visitExpression(node.init);
      }
    }
    if (node.test !== undefined) {
      this.visitExpression(node.test);
    }
    if (node.update !== undefined) {
      this.visitExpression(node.update);
    }
    this.visitStatement(node.body);
  }

  private visitForOfStatement(node: ForInStatement | ForOfStatement): void {
    if (node.left.type === "VariableDeclaration") {
      this.visitVariableDeclaration(node.left);
    } else {
      this.visitPattern(node.left);
    }
    this.visitExpression(node.right);
    this.visitStatement(node.body);
  }

  private visitWhileStatement(node: WhileStatement | DoWhileStatement): void {
    this.visitExpression(node.test);
    this.visitStatement(node.body);
  }

  private visitTryStatement(node: TryStatement): void {
    this.visitStatement(node.block);
    if (node.handler !== undefined) {
      this.visitCatchClause(node.handler);
    }
    if (node.finalizer !== undefined) {
      this.visitStatement(node.finalizer);
    }
  }

  private visitCatchClause(node: CatchClause): void {
    if (node.param !== undefined) {
      this.visitPattern(node.param);
    }
    this.visitStatement(node.body);
  }

  private visitVariableDeclaration(node: VariableDeclaration): void {
    for (const declarator of node.declarations) {
      this.visitVariableDeclarator(declarator);
    }
  }

  private visitVariableDeclarator(node: VariableDeclarator): void {
    this.visitPattern(node.id);
    if (node.init !== undefined) {
      this.visitExpression(node.init);
    }
  }

  private visitReturnStatement(node: ReturnStatement): void {
    if (node.argument !== undefined) {
      this.visitExpression(node.argument);
    }
  }

  private visitThrowStatement(node: ThrowStatement): void {
    this.visitExpression(node.argument);
  }

  private visitExpression(node: Expression): void {
    switch (node.type) {
      case "ArrowFunctionExpression":
        this.visitArrowFunction(node);
        return;
      case "AwaitExpression":
        this.visitExpression(node.argument);
        return;
      case "ArrayExpression":
        this.visitArrayExpression(node);
        return;
      case "ObjectExpression":
        this.visitObjectExpression(node);
        return;
      case "UnaryExpression":
        this.visitUnaryExpression(node);
        return;
      case "BinaryExpression":
      case "LogicalExpression":
        this.visitBinaryLikeExpression(node);
        return;
      case "ConditionalExpression":
        this.visitConditionalExpression(node);
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
        return;
      case "AssignmentExpression":
        this.visitAssignmentExpression(node);
        return;
      case "CallExpression":
        this.visitCallExpression(node);
        return;
      case "TemplateLiteral":
        this.visitTemplateLiteral(node);
        return;
      case "Identifier":
      case "BooleanLiteral":
      case "NullLiteral":
      case "NumericLiteral":
      case "RegexLiteral":
      case "StringLiteral":
      case "UndefinedLiteral":
        return;
    }
  }

  private visitArrowFunction(node: ArrowFunctionExpression): void {
    for (const parameter of node.params) {
      this.visitPattern(parameter);
    }

    if (node.body.type === "BlockStatement") {
      for (const statement of node.body.body) {
        this.visitStatement(statement);
      }
      return;
    }

    this.visitExpression(node.body);
  }

  private visitArrayExpression(node: ArrayExpression): void {
    for (const element of node.elements) {
      if (element.type === "SpreadElement") {
        this.visitExpression(element.argument);
        continue;
      }

      this.visitExpression(element);
    }
  }

  private visitObjectExpression(node: ObjectExpression): void {
    for (const property of node.properties) {
      if (property.type === "SpreadElement") {
        this.visitExpression(property.argument);
        continue;
      }

      this.visitProperty(property);
    }
  }

  private visitProperty(node: Property): void {
    if (node.computed) {
      this.visitExpression(node.key);
    }
    this.visitExpression(node.value);
  }

  private visitUnaryExpression(node: UnaryExpression): void {
    this.visitExpression(node.argument);
  }

  private visitBinaryLikeExpression(node: BinaryExpression | LogicalExpression): void {
    this.visitExpression(node.left);
    this.visitExpression(node.right);
  }

  private visitConditionalExpression(node: ConditionalExpression): void {
    this.visitExpression(node.test);
    this.visitExpression(node.consequent);
    this.visitExpression(node.alternate);
  }

  private visitMemberExpression(node: MemberExpression): void {
    this.visitExpression(node.object);
    if (node.computed) {
      this.visitExpression(node.property);
    }
  }

  private visitAssignmentExpression(node: AssignmentExpression): void {
    this.visitPattern(node.left);
    this.visitExpression(node.right);
  }

  private visitCallExpression(node: CallExpression): void {
    this.visitExpression(node.callee);
    this.reportUnsupportedMethodArgs(node);

    for (const argument of node.arguments) {
      this.visitCallArgument(argument);
    }
  }

  private visitCallArgument(node: Expression | SpreadElement): void {
    if (node.type === "SpreadElement") {
      this.visitExpression(node.argument);
      return;
    }

    this.visitExpression(node);
  }

  private visitTemplateLiteral(node: TemplateLiteral): void {
    for (const expression of node.expressions) {
      this.visitExpression(expression);
    }
  }

  private visitPattern(node: AssignmentExpression["left"] | AssignmentPattern | RestElement): void {
    switch (node.type) {
      case "Identifier":
      case "MetaProperty":
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
        return;
      case "ArrayPattern":
        for (const element of node.elements) {
          if (element === null) {
            continue;
          }
          this.visitPattern(element);
        }
        return;
      case "ObjectPattern":
        for (const property of node.properties) {
          if (property.type === "RestElement") {
            this.visitPattern(property);
            continue;
          }

          if (property.computed) {
            this.visitExpression(property.key);
          }
          this.visitPattern(property.value);
        }
        return;
      case "AssignmentPattern":
        this.visitPattern(node.left);
        this.visitExpression(node.right);
        return;
      case "RestElement":
        this.visitPattern(node.argument);
        return;
    }
  }

  private reportUnsupportedMethodArgs(node: CallExpression): void {
    const methodName = getMemberPropertyName(node.callee);
    if (methodName === undefined) {
      return;
    }

    if (methodName !== "sort") {
      return;
    }

    const comparator = node.arguments[0];
    if (comparator === undefined || comparator.type === "SpreadElement") {
      return;
    }

    if (!isSupportedSortComparator(comparator)) {
      this.report(comparator.span, SORT_MESSAGE);
    }
  }

  private report(span: SourceSpan, message: string): void {
    this.diagnostics.push({
      code: "AS012",
      severity: "error",
      message,
      filename: this.filename,
      line: span.start.line,
      column: span.start.column,
      span
    });
  }
}

function getMemberPropertyName(node: Expression): string | undefined {
  if (node.type !== "MemberExpression") {
    return undefined;
  }

  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }

  if (node.computed && node.property.type === "StringLiteral") {
    return node.property.value;
  }

  return undefined;
}

function isSupportedSortComparator(node: Expression): boolean {
  return node.type === "ArrowFunctionExpression" && !node.async && isNumberReturningArrow(node);
}

function isNumberReturningArrow(node: ArrowFunctionExpression): boolean {
  if (node.body.type === "BlockStatement") {
    return false;
  }

  return isClearlyNumberExpression(node.body);
}

function isClearlyNumberExpression(node: Expression): boolean {
  switch (node.type) {
    case "NumericLiteral":
      return true;
    case "RegexLiteral":
      return false;
    case "UnaryExpression":
      return (
        (node.operator === "+" || node.operator === "-" || node.operator === "~") &&
        isClearlyNumberExpression(node.argument)
      );
    case "BinaryExpression":
      return NUMBER_RETURNING_BINARY_OPERATORS.has(node.operator);
    case "ConditionalExpression":
      return (
        isClearlyNumberExpression(node.consequent) && isClearlyNumberExpression(node.alternate)
      );
    case "CallExpression":
      return isLocaleCompareCall(node);
    default:
      return false;
  }
}

function isLocaleCompareCall(node: CallExpression): boolean {
  return getMemberPropertyName(node.callee) === "localeCompare";
}
