import {
  parseModule,
  type ArrayExpression,
  type FunctionNode,
  type AssignmentExpression,
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
  type SourceSpan,
  type Statement,
  type SwitchStatement,
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
  code: "AS-UNREACHABLE";
  severity: "warning";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

export function AS_UNREACHABLE(source: string, options: { filename?: string } = {}): Diagnostic[] {
  return new ASUnreachableScanner(options.filename ?? "<input>").scan(source);
}

class ASUnreachableScanner {
  private readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly filename: string) {}

  scan(source: string): Diagnostic[] {
    this.visitModule(parseModule(source, this.filename));
    return this.diagnostics;
  }

  private visitModule(node: Module): void {
    this.visitStatements(node.body);
  }

  private visitStatements(statements: readonly Statement[]): boolean {
    let terminated = false;

    for (const statement of statements) {
      if (terminated) {
        if (isEmptyBlockStatement(statement)) {
          continue;
        }

        this.report(statement.span);
        return true;
      }

      terminated = this.visitStatement(statement);
    }

    return terminated;
  }

  private visitStatement(node: Statement): boolean {
    switch (node.type) {
      case "FunctionDeclaration":
        this.visitArrowFunction(node);
        return false;
      case "BlockStatement":
        return this.visitBlock(node);
      case "ExpressionStatement":
        this.visitExpression(node.expression);
        return false;
      case "IfStatement":
        return this.visitIfStatement(node);
      case "ForStatement":
        this.visitForStatement(node);
        return false;
      case "ForInStatement":
      case "ForOfStatement":
        this.visitForOfStatement(node);
        return false;
      case "WhileStatement":
      case "DoWhileStatement":
        this.visitWhileStatement(node);
        return false;
      case "TryStatement":
        return this.visitTryStatement(node);
      case "SwitchStatement":
        this.visitSwitchStatement(node);
        return false;
      case "VariableDeclaration":
        this.visitVariableDeclaration(node);
        return false;
      case "ReturnStatement":
        if (node.argument !== undefined) {
          this.visitExpression(node.argument);
        }
        return true;
      case "ThrowStatement":
        this.visitThrowStatement(node);
        return true;
      case "BreakStatement":
      case "ContinueStatement":
        return true;
      case "ExportNamedDeclaration":
        this.visitVariableDeclaration(node.declaration);
        return false;
      case "ExportDefaultDeclaration":
        this.visitExpression(node.declaration);
        return false;
      case "ImportDeclaration":
      case "EmptyStatement":
        return false;
    }
  }

  private visitBlock(node: BlockStatement): boolean {
    return this.visitStatements(node.body);
  }

  private visitIfStatement(node: IfStatement): boolean {
    this.visitExpression(node.test);
    const consequentTerminates = this.visitStatement(node.consequent);
    const alternateTerminates =
      node.alternate === undefined ? false : this.visitStatement(node.alternate);

    return node.alternate !== undefined && consequentTerminates && alternateTerminates;
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

  private visitTryStatement(node: TryStatement): boolean {
    const tryTerminates = this.visitBlock(node.block);
    const catchTerminates =
      node.handler === undefined ? false : this.visitCatchClause(node.handler);
    const finallyTerminates =
      node.finalizer === undefined ? false : this.visitBlock(node.finalizer);

    if (finallyTerminates) {
      return true;
    }

    if (node.handler === undefined) {
      return tryTerminates;
    }

    return tryTerminates && catchTerminates;
  }

  private visitSwitchStatement(node: SwitchStatement): void {
    this.visitExpression(node.discriminant);
    for (const switchCase of node.cases) {
      if (switchCase.test !== undefined) {
        this.visitExpression(switchCase.test);
      }
      this.visitStatements(switchCase.consequent);
    }
  }

  private visitCatchClause(node: CatchClause): boolean {
    return this.visitBlock(node.body);
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

  private visitThrowStatement(node: ThrowStatement): void {
    this.visitExpression(node.argument);
  }

  private visitExpression(node: Expression): void {
    switch (node.type) {
      case "YieldExpression":
        if (node.argument !== undefined) {
          this.visitExpression(node.argument);
        }
        return;
      case "FunctionExpression":
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
      case "TaggedTemplateExpression":
        this.visitTaggedTemplateExpression(node);
        return;
      case "TemplateLiteral":
        this.visitTemplateLiteral(node);
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

  private visitArrowFunction(node: FunctionNode): void {
    if (node.body.type === "BlockStatement") {
      this.visitBlock(node.body);
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
    this.visitExpression(node.key);
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
    this.visitExpression(node.property);
  }

  private visitAssignmentExpression(node: AssignmentExpression): void {
    if (node.left.type === "MemberExpression") {
      this.visitMemberExpression(node.left);
    }
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

  private visitTaggedTemplateExpression(node: TaggedTemplateExpression): void {
    this.visitExpression(node.tag);
    this.visitTemplateLiteral(node.quasi);
  }

  private visitTemplateLiteral(node: TemplateLiteral): void {
    for (const expression of node.expressions) {
      this.visitExpression(expression);
    }
  }

  private report(span: SourceSpan): void {
    this.diagnostics.push({
      code: "AS-UNREACHABLE",
      severity: "warning",
      message: "Statement is unreachable because a prior statement in the same block always exits.",
      filename: this.filename,
      line: span.start.line,
      column: span.start.column,
      span
    });
  }
}

function isEmptyBlockStatement(statement: Statement): boolean {
  return statement.type === "BlockStatement" && statement.body.length === 0;
}
