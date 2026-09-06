import { visitClassElements } from "../class-elements.js";
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
  code: "AS-UNBOUNDED-LOOP";
  severity: "warning";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

const MESSAGE =
  "Unbounded loop or generator source has no static exit with break, return, or throw.";

type LoopStatement =
  | DoWhileStatement
  | ForInStatement
  | ForOfStatement
  | ForStatement
  | WhileStatement;
type UnboundedLoopStatement = DoWhileStatement | ForStatement | WhileStatement;

export function AS_UNBOUNDED_LOOP(
  source: string,
  options: { filename?: string } = {}
): Diagnostic[] {
  return new ASUnboundedLoopScanner(options.filename ?? "<input>").scan(source);
}

class ASUnboundedLoopScanner {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly labelStack: string[] = [];

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
    if (node.type === "ClassDeclaration") {
      visitClassElements(node, expression => this.visitExpression(expression), statement => this.visitStatement(statement));
      return;
    }
    switch (node.type) {
      case "FunctionDeclaration":
        this.visitArrowFunction(node);
        return;
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
        this.visitWhileStatement(node);
        return;
      case "DoWhileStatement":
        this.visitDoWhileStatement(node);
        return;
      case "TryStatement":
        this.visitTryStatement(node);
        return;
      case "VariableDeclaration":
        this.visitVariableDeclaration(node);
        return;
      case "ReturnStatement":
        if (node.argument !== undefined) {
          this.visitExpression(node.argument);
        }
        return;
      case "ThrowStatement":
        this.visitThrowStatement(node);
        return;
      case "ExportNamedDeclaration":
        this.visitVariableDeclaration(node.declaration);
        return;
      case "ExportDefaultDeclaration":
        if (node.declaration.type === "ClassDeclaration" || node.declaration.type === "FunctionDeclaration") this.visitStatement(node.declaration);
        else this.visitExpression(node.declaration);
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
    this.visitLoopBody(node, () => {
      this.reportIfUnboundedWithoutExit(node);
      this.visitStatement(node.body);
    });
  }

  private visitForOfStatement(node: ForInStatement | ForOfStatement): void {
    if (node.left.type === "VariableDeclaration") {
      this.visitVariableDeclaration(node.left);
    }
    this.visitExpression(node.right);
    this.visitLoopBody(node, () => {
      this.visitStatement(node.body);
    });
  }

  private visitWhileStatement(node: WhileStatement): void {
    this.visitExpression(node.test);
    this.visitLoopBody(node, () => {
      this.reportIfUnboundedWithoutExit(node);
      this.visitStatement(node.body);
    });
  }

  private visitDoWhileStatement(node: DoWhileStatement): void {
    this.visitExpression(node.test);
    this.visitLoopBody(node, () => {
      this.reportIfUnboundedWithoutExit(node);
      this.visitStatement(node.body);
    });
  }

  private visitLoopBody(node: LoopStatement, callback: () => void): void {
    const labels = getLoopLabels(node);
    this.labelStack.push(...labels);
    callback();
    this.labelStack.length -= labels.length;
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

  private visitThrowStatement(node: ThrowStatement): void {
    this.visitExpression(node.argument);
  }

  private visitExpression(node: Expression): void {
    if (node.type === "ClassExpression") {
      visitClassElements(node, expression => this.visitExpression(expression), statement => this.visitStatement(statement));
      return;
    }
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
      case "TemplateLiteral":
        this.visitTemplateLiteral(node);
        return;
      case "TaggedTemplateExpression":
        this.visitTaggedTemplateExpression(node);
        return;
      case "Identifier":
      case "BooleanLiteral":
      case "NullLiteral":
      case "NumericLiteral":
      case "StringLiteral":
      case "RegexLiteral":
      case "MetaProperty":
      case "UndefinedLiteral":
        return;
    }
  }

  private visitArrowFunction(node: FunctionNode): void {
    const labels = this.labelStack.splice(0);
    try {
      if (node.body.type === "BlockStatement") {
        this.visitBlockStatement(node.body);
        return;
      }

      this.visitExpression(node.body);
    } finally {
      this.labelStack.push(...labels);
    }
  }

  private visitArrayExpression(node: ArrayExpression): void {
    for (const element of node.elements) {
      if (element.type === "SpreadElement") {
        this.visitExpression(element.argument);
      } else {
        this.visitExpression(element);
      }
    }
  }

  private visitObjectExpression(node: ObjectExpression): void {
    for (const property of node.properties) {
      if (property.type === "SpreadElement") {
        this.visitExpression(property.argument);
      } else {
        this.visitProperty(property);
      }
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
      } else {
        this.visitExpression(argument);
      }
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

  private reportIfUnboundedWithoutExit(node: UnboundedLoopStatement): void {
    if (!isUnboundedLoop(node)) {
      return;
    }

    const exitingLabels = new Set([...this.labelStack, ...getLoopLabels(node)]);
    if (bodyHasExit(node.body, exitingLabels, true)) {
      return;
    }

    this.diagnostics.push({
      code: "AS-UNBOUNDED-LOOP",
      severity: "warning",
      message: MESSAGE,
      filename: this.filename,
      line: node.span.start.line,
      column: node.span.start.column,
      span: node.span
    });
  }
}

function isUnboundedLoop(node: UnboundedLoopStatement): boolean {
  switch (node.type) {
    case "ForStatement":
      return node.test === undefined;
    case "WhileStatement":
    case "DoWhileStatement":
      return isTrueLiteral(node.test);
  }
}

function getLoopLabels(node: LoopStatement): readonly string[] {
  return node.labels ?? (node.label === undefined ? [] : [node.label]);
}

function isTrueLiteral(node: Expression): boolean {
  return node.type === "BooleanLiteral" && node.value;
}

function bodyHasExit(
  node: Statement,
  exitingLabels: ReadonlySet<string>,
  allowUnlabeledBreak: boolean
): boolean {
  switch (node.type) {
    case "ClassDeclaration":
      return false;
    case "BlockStatement":
      return node.body.some((statement) =>
        bodyHasExit(statement, exitingLabels, allowUnlabeledBreak)
      );
    case "IfStatement":
      return (
        bodyHasExit(node.consequent, exitingLabels, allowUnlabeledBreak) ||
        (node.alternate !== undefined &&
          bodyHasExit(node.alternate, exitingLabels, allowUnlabeledBreak))
      );
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
      return bodyHasExit(node.body, exitingLabels, false);
    case "TryStatement":
      return (
        bodyHasExit(node.block, exitingLabels, allowUnlabeledBreak) ||
        (node.handler !== undefined &&
          bodyHasExit(node.handler.body, exitingLabels, allowUnlabeledBreak)) ||
        (node.finalizer !== undefined &&
          bodyHasExit(node.finalizer, exitingLabels, allowUnlabeledBreak))
      );
    case "SwitchStatement":
      return node.cases.some((switchCase) =>
        switchCase.consequent.some((statement) => bodyHasExit(statement, exitingLabels, false))
      );
    case "ReturnStatement":
    case "ThrowStatement":
      return true;
    case "BreakStatement":
      return node.label === undefined ? allowUnlabeledBreak : exitingLabels.has(node.label);
    case "ExportNamedDeclaration":
      return false;
    case "ExportDefaultDeclaration":
    case "ExpressionStatement":
    case "ImportDeclaration":
    case "FunctionDeclaration":
    case "ContinueStatement":
    case "EmptyStatement":
    case "VariableDeclaration":
      return false;
  }
}
