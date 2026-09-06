import { visitClassElements } from "../class-elements.js";
import {
  parseModule,
  type ArrayExpression,
  type ArrayPattern,
  type FunctionNode,
  type AssignmentExpression,
  type AssignmentPattern,
  type AssignmentProperty,
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
  type PatternTarget,
  type Property,
  type RestElement,
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
  code: "AS-FRONTMATTER-FIELD-UNUSED";
  severity: "info";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

export function AS_FRONTMATTER_FIELD_UNUSED(
  source: string,
  options: { filename?: string; frontmatterFields?: readonly string[] } = {}
): Diagnostic[] {
  if (options.frontmatterFields === undefined) {
    return [];
  }

  return new ASFrontmatterFieldUnusedScanner(
    options.filename ?? "<input>",
    new Set(options.frontmatterFields)
  ).scan(source);
}

class ASFrontmatterFieldUnusedScanner {
  private readonly reads = new Set<string>();
  private suppressDiagnostics = false;

  constructor(
    private readonly filename: string,
    private readonly fields: ReadonlySet<string>
  ) {}

  scan(source: string): Diagnostic[] {
    if (this.fields.size === 0) {
      return [];
    }

    const module = parseModule(source, this.filename);
    this.visitModule(module);

    if (this.suppressDiagnostics) {
      return [];
    }

    return [...this.fields]
      .filter((field) => !this.reads.has(field))
      .sort()
      .map((field) => this.createDiagnostic(module.span, field));
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
        if (node.declaration.type === "ClassDeclaration") this.visitStatement(node.declaration);
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
    this.visitStatement(node.body);
  }

  private visitForOfStatement(node: ForInStatement | ForOfStatement): void {
    if (node.left.type === "VariableDeclaration") {
      this.visitVariableDeclaration(node.left);
    } else {
      this.visitAssignmentTarget(node.left);
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
      this.visitBindingPattern(node.param);
    }
    this.visitBlockStatement(node.body);
  }

  private visitVariableDeclaration(node: VariableDeclaration): void {
    for (const declarator of node.declarations) {
      this.visitVariableDeclarator(declarator);
    }
  }

  private visitVariableDeclarator(node: VariableDeclarator): void {
    if (node.init !== undefined && isFrontmatterIdentifier(node.init)) {
      this.collectObjectPatternReads(node.id);
    } else {
      this.visitBindingPattern(node.id);
      if (node.init !== undefined) {
        this.visitExpression(node.init);
      }
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
    for (const parameter of node.params) {
      this.visitBindingElement(parameter);
    }
    if (node.body.type === "BlockStatement") {
      this.visitBlockStatement(node.body);
      return;
    }

    this.visitExpression(node.body);
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
    if (isFrontmatterIdentifier(node.object)) {
      this.collectMemberRead(node);
    } else {
      this.visitExpression(node.object);
    }

    if (node.computed) {
      this.visitExpression(node.property);
    }
  }

  private visitAssignmentExpression(node: AssignmentExpression): void {
    if (isFrontmatterIdentifier(node.right)) {
      this.collectObjectPatternReads(node.left);
      return;
    }

    this.visitAssignmentTarget(node.left);
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

  private visitBindingElement(
    node: AssignmentPattern | ArrayPattern | ObjectPattern | RestElement | PatternTarget
  ): void {
    if (node.type === "RestElement") {
      this.visitBindingPattern(node.argument);
      return;
    }
    this.visitBindingPattern(node);
  }

  private visitBindingPattern(
    node: AssignmentPattern | ArrayPattern | ObjectPattern | PatternTarget
  ): void {
    switch (node.type) {
      case "Identifier":
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
        return;
      case "AssignmentPattern":
        this.visitAssignmentPattern(node);
        return;
      case "ArrayPattern":
        this.visitArrayPattern(node);
        return;
      case "ObjectPattern":
        this.visitObjectPattern(node);
        return;
    }
  }

  private visitAssignmentPattern(node: AssignmentPattern): void {
    this.visitBindingPattern(node.left);
    this.visitExpression(node.right);
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
        this.visitBindingPattern(property.argument);
      } else {
        this.visitAssignmentProperty(property);
      }
    }
  }

  private visitAssignmentProperty(node: AssignmentProperty): void {
    if (node.computed) {
      this.visitExpression(node.key);
    }
    this.visitBindingPattern(node.value);
  }

  private visitAssignmentTarget(node: AssignmentExpression["left"]): void {
    if (node.type !== "MetaProperty") {
      this.visitBindingPattern(node);
    }
  }

  private collectMemberRead(node: MemberExpression): void {
    if (!node.computed && node.property.type === "Identifier") {
      this.markRead(node.property.name);
      return;
    }

    if (node.computed && node.property.type === "StringLiteral") {
      this.markRead(node.property.value);
      return;
    }

    if (node.computed) {
      this.suppressDiagnostics = true;
    }
  }

  private collectObjectPatternReads(
    node: AssignmentExpression["left"] | VariableDeclarator["id"]
  ): void {
    if (node.type !== "ObjectPattern") {
      if (node.type !== "MetaProperty") {
        this.visitBindingPattern(node);
      }
      return;
    }

    for (const property of node.properties) {
      if (property.type === "RestElement") {
        this.suppressDiagnostics = true;
        continue;
      }

      const field = readStaticPropertyKey(property);
      if (field === undefined) {
        this.suppressDiagnostics = true;
        continue;
      }

      this.markRead(field);
      this.visitBindingPattern(property.value);
    }
  }

  private markRead(field: string): void {
    if (this.fields.has(field)) {
      this.reads.add(field);
    }
  }

  private createDiagnostic(span: SourceSpan, field: string): Diagnostic {
    return {
      code: "AS-FRONTMATTER-FIELD-UNUSED",
      severity: "info",
      message: `Frontmatter field '${field}' is declared by the schema but never read.`,
      filename: this.filename,
      line: span.start.line,
      column: span.start.column,
      span
    };
  }
}

function isFrontmatterIdentifier(node: Expression): node is Identifier {
  return node.type === "Identifier" && node.name === "frontmatter";
}

function readStaticPropertyKey(property: AssignmentProperty): string | undefined {
  if (property.computed) {
    return property.key.type === "StringLiteral" ? property.key.value : undefined;
  }

  return readPropertyKey(property.key);
}

function readPropertyKey(node: Expression): string | undefined {
  if (node.type === "Identifier") {
    return node.name;
  }

  if (node.type === "StringLiteral") {
    return node.value;
  }

  return undefined;
}
