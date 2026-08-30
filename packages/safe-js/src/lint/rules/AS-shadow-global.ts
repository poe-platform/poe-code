import {
  parseModule,
  type ArrayExpression,
  type ArrayPattern,
  type FunctionNode,
  type AssignmentExpression,
  type AssignmentPattern,
  type AssignmentProperty,
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
  type Identifier,
  type IfStatement,
  type LogicalExpression,
  type MemberExpression,
  type Module,
  type ObjectExpression,
  type ObjectPattern,
  type Property,
  type RestElement,
  type ReturnStatement,
  type SourceSpan,
  type SpreadElement,
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
import { KNOWN_RUNTIME_GLOBALS } from "./known-globals.js";

export type Diagnostic = {
  code: "AS-SHADOW-GLOBAL";
  severity: "warning";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

export function AS_SHADOW_GLOBAL(
  source: string,
  options: { allowedGlobals?: readonly string[]; filename?: string } = {}
): Diagnostic[] {
  return new ASShadowGlobalScanner(
    options.filename ?? "<input>",
    new Set([...KNOWN_RUNTIME_GLOBALS, ...(options.allowedGlobals ?? [])])
  ).scan(source);
}

class ASShadowGlobalScanner {
  private readonly diagnostics: Diagnostic[] = [];

  constructor(
    private readonly filename: string,
    private readonly knownGlobals: ReadonlySet<string>
  ) {}

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
      case "FunctionDeclaration":
        this.visitArrowFunctionExpression(node);
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
    } else {
      this.visitAssignmentTargetPattern(node.left);
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
    if (node.param !== undefined) {
      this.visitPatternTarget(node.param);
    }
    this.visitBlockStatement(node.body);
  }

  private visitReturnStatement(node: ReturnStatement): void {
    if (node.argument !== undefined) {
      this.visitExpression(node.argument);
    }
  }

  private visitThrowStatement(node: ThrowStatement): void {
    this.visitExpression(node.argument);
  }

  private visitVariableDeclaration(node: VariableDeclaration): void {
    for (const declarator of node.declarations) {
      this.visitVariableDeclarator(declarator);
    }
  }

  private visitVariableDeclarator(node: VariableDeclarator): void {
    this.visitPatternTarget(node.id);
    if (node.init !== undefined) {
      this.visitExpression(node.init);
    }
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
        this.visitArrowFunctionExpression(node);
        return;
      case "ArrayExpression":
        this.visitArrayExpression(node);
        return;
      case "AwaitExpression":
        this.visitAwaitExpression(node);
        return;
      case "BinaryExpression":
        this.visitBinaryExpression(node);
        return;
      case "CallExpression":
        this.visitCallExpression(node);
        return;
      case "ConditionalExpression":
        this.visitConditionalExpression(node);
        return;
      case "LogicalExpression":
        this.visitLogicalExpression(node);
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
        return;
      case "ObjectExpression":
        this.visitObjectExpression(node);
        return;
      case "TaggedTemplateExpression":
        this.visitTaggedTemplateExpression(node);
        return;
      case "TemplateLiteral":
        this.visitTemplateLiteral(node);
        return;
      case "UnaryExpression":
        this.visitUnaryExpression(node);
        return;
      case "AssignmentExpression":
        this.visitAssignmentExpression(node);
        return;
      case "BooleanLiteral":
      case "Identifier":
      case "MetaProperty":
      case "NullLiteral":
      case "NumericLiteral":
      case "RegexLiteral":
      case "StringLiteral":
      case "UndefinedLiteral":
        return;
    }
  }

  private visitArrowFunctionExpression(node: FunctionNode): void {
    if (node.type !== "ArrowFunctionExpression" && node.id !== undefined) {
      this.reportIfGlobalShadow(node.id);
    }
    for (const parameter of node.params) {
      this.visitBindingElement(parameter);
    }
    if (node.body.type === "BlockStatement") {
      this.visitBlockStatement(node.body);
    } else {
      this.visitExpression(node.body);
    }
  }

  private visitArrayExpression(node: ArrayExpression): void {
    for (const element of node.elements) {
      if (element.type === "SpreadElement") {
        this.visitSpreadElement(element);
      } else {
        this.visitExpression(element);
      }
    }
  }

  private visitAwaitExpression(node: AwaitExpression): void {
    this.visitExpression(node.argument);
  }

  private visitBinaryExpression(node: BinaryExpression): void {
    this.visitExpression(node.left);
    this.visitExpression(node.right);
  }

  private visitCallExpression(node: CallExpression): void {
    this.visitExpression(node.callee);
    for (const argument of node.arguments) {
      if (argument.type === "SpreadElement") {
        this.visitSpreadElement(argument);
      } else {
        this.visitExpression(argument);
      }
    }
  }

  private visitConditionalExpression(node: ConditionalExpression): void {
    this.visitExpression(node.test);
    this.visitExpression(node.consequent);
    this.visitExpression(node.alternate);
  }

  private visitLogicalExpression(node: LogicalExpression): void {
    this.visitExpression(node.left);
    this.visitExpression(node.right);
  }

  private visitMemberExpression(node: MemberExpression): void {
    this.visitExpression(node.object);
    if (node.computed) {
      this.visitExpression(node.property);
    }
  }

  private visitObjectExpression(node: ObjectExpression): void {
    for (const property of node.properties) {
      if (property.type === "SpreadElement") {
        this.visitSpreadElement(property);
      } else {
        this.visitProperty(property);
      }
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

  private visitUnaryExpression(node: UnaryExpression): void {
    this.visitExpression(node.argument);
  }

  private visitAssignmentExpression(node: AssignmentExpression): void {
    this.visitAssignmentTargetPattern(node.left);
    this.visitExpression(node.right);
  }

  private visitAssignmentTargetPattern(
    node: AssignmentExpression["left"] | AssignmentPattern | RestElement
  ): void {
    switch (node.type) {
      case "AssignmentPattern":
        this.visitAssignmentTargetPattern(node.left);
        this.visitExpression(node.right);
        return;
      case "RestElement":
        this.visitAssignmentTargetPattern(node.argument);
        return;
      case "ArrayPattern":
        this.visitAssignmentArrayPattern(node);
        return;
      case "ObjectPattern":
        this.visitAssignmentObjectPattern(node);
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
        return;
      case "Identifier":
      case "MetaProperty":
        return;
    }
  }

  private visitAssignmentArrayPattern(node: ArrayPattern): void {
    for (const element of node.elements) {
      if (element !== null) {
        this.visitAssignmentTargetPattern(element);
      }
    }
  }

  private visitAssignmentObjectPattern(node: ObjectPattern): void {
    for (const property of node.properties) {
      if (property.type === "RestElement") {
        this.visitAssignmentTargetPattern(property.argument);
        continue;
      }
      if (property.computed) {
        this.visitExpression(property.key);
      }
      this.visitAssignmentTargetPattern(property.value);
    }
  }

  private visitProperty(node: Property): void {
    if (node.computed) {
      this.visitExpression(node.key);
    }
    this.visitExpression(node.value);
  }

  private visitSpreadElement(node: SpreadElement): void {
    this.visitExpression(node.argument);
  }

  private visitBindingElement(
    node:
      | AssignmentPattern
      | ArrayPattern
      | Identifier
      | MemberExpression
      | ObjectPattern
      | RestElement
  ): void {
    switch (node.type) {
      case "AssignmentPattern":
        this.visitPatternTarget(node.left);
        this.visitExpression(node.right);
        return;
      case "RestElement":
        this.visitPatternTarget(node.argument);
        return;
      default:
        this.visitPatternTarget(node);
        return;
    }
  }

  private visitPatternTarget(
    node: ArrayPattern | Identifier | MemberExpression | ObjectPattern
  ): void {
    switch (node.type) {
      case "Identifier":
        this.reportIfGlobalShadow(node);
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
        return;
      case "ArrayPattern":
        this.visitArrayPattern(node);
        return;
      case "ObjectPattern":
        this.visitObjectPattern(node);
        return;
    }
  }

  private visitArrayPattern(node: ArrayPattern): void {
    for (const element of node.elements) {
      if (element !== null) {
        this.visitBindingElement(element);
      }
    }
  }

  private visitObjectPattern(node: ObjectPattern): void {
    for (const property of node.properties) {
      if (property.type === "RestElement") {
        this.visitPatternTarget(property.argument);
        continue;
      }
      this.visitAssignmentProperty(property);
    }
  }

  private visitAssignmentProperty(node: AssignmentProperty): void {
    if (node.computed) {
      this.visitExpression(node.key);
    }
    this.visitBindingElement(node.value);
  }

  private reportIfGlobalShadow(node: Identifier): void {
    if (!this.knownGlobals.has(node.name)) {
      return;
    }

    this.diagnostics.push({
      code: "AS-SHADOW-GLOBAL",
      severity: "warning",
      message: `Local binding '${node.name}' shadows a runtime global.`,
      filename: this.filename,
      line: node.span.start.line,
      column: node.span.start.column,
      span: node.span
    });
  }
}
