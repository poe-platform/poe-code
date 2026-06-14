import {
  parseModule,
  type ArrayExpression,
  type ArrowFunctionExpression,
  type AssignmentExpression,
  type AwaitExpression,
  type BinaryExpression,
  type BlockStatement,
  type CallExpression,
  type CatchClause,
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
  type SourceSpan,
  type Statement,
  type TaggedTemplateExpression,
  type TemplateLiteral,
  type ThrowStatement,
  type TryStatement,
  type UnaryExpression,
  type VariableDeclaration,
  type VariableDeclarator,
  type WhileStatement
} from "../../parse/parser.js";

export type Diagnostic = {
  code: "AS-AWAIT-NON-PROMISE";
  severity: "warning";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

export function AS_AWAIT_NON_PROMISE(
  source: string,
  options: { filename?: string } = {}
): Diagnostic[] {
  return new ASAwaitNonPromiseScanner(options.filename ?? "<input>").scan(source);
}

class ASAwaitNonPromiseScanner {
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
        this.visitBlockStatement(node);
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

  private visitBlockStatement(node: BlockStatement): void {
    for (const statement of node.body) {
      this.visitStatement(statement);
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
    }
    this.visitExpression(node.right);
    this.visitStatement(node.body);
  }

  private visitWhileStatement(node: WhileStatement | DoWhileStatement): void {
    this.visitExpression(node.test);
    this.visitStatement(node.body);
  }

  private visitTryStatement(node: TryStatement): void {
    this.visitBlockStatement(node.block);
    if (node.handler !== undefined) {
      this.visitCatchClause(node.handler);
    }
    if (node.finalizer !== undefined) {
      this.visitBlockStatement(node.finalizer);
    }
  }

  private visitCatchClause(node: CatchClause): void {
    this.visitBlockStatement(node.body);
  }

  private visitVariableDeclaration(node: VariableDeclaration): void {
    for (const declarator of node.declarations) {
      this.visitVariableDeclarator(declarator);
    }
  }

  private visitVariableDeclarator(node: VariableDeclarator): void {
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
        this.visitAwaitExpression(node);
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
      case "TaggedTemplateExpression":
        this.visitTaggedTemplateExpression(node);
        return;
      case "Identifier":
      case "BooleanLiteral":
      case "MetaProperty":
      case "NullLiteral":
      case "NumericLiteral":
      case "RegexLiteral":
      case "StringLiteral":
      case "UndefinedLiteral":
        return;
    }
  }

  private visitArrowFunction(node: ArrowFunctionExpression): void {
    if (node.body.type === "BlockStatement") {
      this.visitBlockStatement(node.body);
      return;
    }

    this.visitExpression(node.body);
  }

  private visitAwaitExpression(node: AwaitExpression): void {
    if (isKnownNonPromiseExpression(node.argument)) {
      this.report(node.argument.span);
    }

    this.visitExpression(node.argument);
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
    this.visitExpression(node.right);
  }

  private visitCallExpression(node: CallExpression): void {
    this.visitExpression(node.callee);
    for (const argument of node.arguments) {
      if (argument.type === "SpreadElement") {
        this.visitExpression(argument.argument);
        continue;
      }

      this.visitExpression(argument);
    }
  }

  private visitTemplateLiteral(node: TemplateLiteral): void {
    for (const expression of node.expressions) {
      this.visitExpression(expression);
    }
  }

  private visitTaggedTemplateExpression(node: TaggedTemplateExpression): void {
    this.visitExpression(node.tag);
    this.visitTemplateLiteral(node.quasi);
  }

  private report(span: SourceSpan): void {
    this.diagnostics.push({
      code: "AS-AWAIT-NON-PROMISE",
      severity: "warning",
      message: "Awaiting a known non-promise value has no effect.",
      filename: this.filename,
      line: span.start.line,
      column: span.start.column,
      span
    });
  }
}

function isKnownNonPromiseExpression(node: Expression): boolean {
  switch (node.type) {
    case "ArrowFunctionExpression":
    case "ArrayExpression":
    case "BinaryExpression":
    case "BooleanLiteral":
    case "NullLiteral":
    case "NumericLiteral":
    case "ObjectExpression":
    case "StringLiteral":
    case "TemplateLiteral":
    case "UnaryExpression":
      return true;
    default:
      return false;
  }
}
