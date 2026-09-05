import { visitClassElements } from "../class-elements.js";
import {
  type ClassNode,
  parseModule,
  type ArrayExpression,
  type ArrayPattern,
  type FunctionNode,
  type AssignmentExpression,
  type AssignmentPattern,
  type CatchClause,
  type CallExpression,
  type ConditionalExpression,
  type DoWhileStatement,
  type Expression,
  type ForInStatement,
  type ForOfStatement,
  type ForStatement,
  type Identifier,
  type IfStatement,
  type ImportDeclaration,
  type ImportDefaultSpecifier,
  type ImportNamespaceSpecifier,
  type ImportSpecifier,
  type LogicalExpression,
  type MemberExpression,
  type Module,
  type ObjectExpression,
  type ObjectPattern,
  type Property,
  type RestElement,
  type ReturnStatement,
  type SourceSpan,
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
  code: "AS009";
  severity: "error";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

type BindingKind = "import" | "namespace" | "local";
type Scope = Map<string, BindingKind>;

const MESSAGE =
  "Async arrow returns a host call without awaiting it. Add 'await' or document that this function intentionally returns a Promise.";

export function AS009(source: string, options: { filename?: string } = {}): Diagnostic[] {
  return new AS009Scanner(options.filename ?? "<input>").scan(source);
}

class AS009Scanner {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly scopes: Scope[] = [];
  private readonly functionStack: boolean[] = [];

  constructor(private readonly filename: string) {}

  scan(source: string): Diagnostic[] {
    const module = parseModule(source, this.filename);
    this.pushScope(this.collectModuleBindings(module));
    this.visitModule(module);
    this.popScope();
    return this.diagnostics;
  }

  private visitModule(node: Module): void {
    this.visitStatements(node.body);
  }

  private visitStatements(body: Statement[]): void {
    for (const statement of body) {
      this.visitStatement(statement);
    }
  }

  private visitStatement(node: Statement): void {
    if (node.type === "ClassDeclaration") {
      this.visitClass(node);
      return;
    }
    switch (node.type) {
      case "FunctionDeclaration":
        this.visitArrowFunction(node);
        return;
      case "BlockStatement":
        this.visitBlockStatement(node.body);
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

  private visitBlockStatement(body: Statement[]): void {
    this.withScope(this.collectBlockBindings(body), () => {
      this.visitStatements(body);
    });
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
    this.visitStatement(node.block);
    if (node.handler !== undefined) {
      this.visitCatchClause(node.handler);
    }
    if (node.finalizer !== undefined) {
      this.visitStatement(node.finalizer);
    }
  }

  private visitCatchClause(node: CatchClause): void {
    const scope = new Map<string, BindingKind>();
    if (node.param !== undefined) {
      this.collectBindingNamesFromPattern(node.param, scope);
    }

    this.withScope(scope, () => {
      this.visitBlockStatement(node.body.body);
    });
  }

  private visitReturnStatement(node: ReturnStatement): void {
    if (node.argument !== undefined) {
      if (this.isInsideAsyncArrow()) {
        this.reportMissingAwait(node.argument);
      }
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
    this.visitBindingElement(node.id);
    if (node.init !== undefined) {
      this.visitExpression(node.init);
    }
  }

  private visitClass(node: ClassNode): void {
    const scope: Scope = new Map();
    if (node.id !== undefined) scope.set(node.id.name, "local");
    this.withScope(scope, () => {
      visitClassElements(node, expression => this.visitExpression(expression), statement => this.visitStatement(statement));
    });
  }

  private visitExpression(node: Expression): void {
    if (node.type === "ClassExpression") {
      this.visitClass(node);
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
        this.visitExpression(node.left);
        this.visitExpression(node.right);
        return;
      case "LogicalExpression":
        this.visitLogicalExpression(node);
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
      case "StringLiteral":
      case "UndefinedLiteral":
        return;
    }
  }

  private visitArrowFunction(node: FunctionNode): void {
    const scope = new Map<string, BindingKind>();

    for (const parameter of node.params) {
      this.collectBindingNamesFromElement(parameter, scope);
    }

    if (node.body.type === "BlockStatement") {
      this.mergeScope(scope, this.collectBlockBindings(node.body.body));
    }

    this.functionStack.push(node.async);
    this.pushScope(scope);

    if (node.async && node.body.type !== "BlockStatement") {
      this.reportMissingAwait(node.body);
    }

    if (node.body.type === "BlockStatement") {
      this.visitStatements(node.body.body);
    } else {
      this.visitExpression(node.body);
    }

    this.popScope();
    this.functionStack.pop();
  }

  private visitArrayExpression(node: ArrayExpression): void {
    for (const element of node.elements) {
      if (element !== null) {
        if (element.type === "SpreadElement") {
          this.visitExpression(element.argument);
        } else {
          this.visitExpression(element);
        }
      }
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

  private visitLogicalExpression(node: LogicalExpression): void {
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
    this.visitAssignmentTarget(node.left);
    this.visitExpression(node.right);
  }

  private visitCallExpression(node: CallExpression): void {
    this.visitExpression(node.callee);
    for (const arg of node.arguments) {
      if (arg.type === "SpreadElement") {
        this.visitExpression(arg.argument);
      } else {
        this.visitExpression(arg);
      }
    }
  }

  private visitTemplateLiteral(node: TemplateLiteral): void {
    for (const expression of node.expressions) {
      this.visitExpression(expression);
    }
  }

  private visitAssignmentTarget(
    node: AssignmentExpression["left"] | AssignmentPattern | RestElement
  ): void {
    switch (node.type) {
      case "Identifier":
      case "MetaProperty":
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
        return;
      case "AssignmentPattern":
        this.visitAssignmentTarget(node.left);
        this.visitExpression(node.right);
        return;
      case "RestElement":
        this.visitAssignmentTarget(node.argument);
        return;
      case "ArrayPattern":
        for (const element of node.elements) {
          if (element !== null) {
            this.visitAssignmentTarget(element);
          }
        }
        return;
      case "ObjectPattern":
        for (const property of node.properties) {
          if (property.type === "RestElement") {
            this.visitAssignmentTarget(property.argument);
            continue;
          }

          if (property.computed) {
            this.visitExpression(property.key);
          }
          this.visitAssignmentTarget(property.value);
        }
        return;
    }
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
        this.visitBindingElement(node.left);
        this.visitExpression(node.right);
        return;
      case "RestElement":
        this.visitBindingElement(node.argument);
        return;
      default:
        this.visitAssignmentTarget(node);
        return;
    }
  }

  private reportMissingAwait(node: Expression): void {
    if (node.type !== "CallExpression") {
      return;
    }

    if (!this.isHostCall(node)) {
      return;
    }

    this.diagnostics.push({
      code: "AS009",
      severity: "error",
      message: MESSAGE,
      filename: this.filename,
      line: node.span.start.line,
      column: node.span.start.column,
      span: node.span
    });
  }

  private isHostCall(node: CallExpression): boolean {
    const root = this.findRootIdentifier(node.callee);
    if (root === undefined) {
      return false;
    }

    const binding = this.resolveBinding(root.name);
    return binding === "import" || binding === "namespace";
  }

  private findRootIdentifier(node: Expression): Identifier | undefined {
    switch (node.type) {
      case "Identifier":
        return node;
      case "MemberExpression":
        return this.findRootIdentifier(node.object);
      default:
        return undefined;
    }
  }

  private isInsideAsyncArrow(): boolean {
    return this.functionStack[this.functionStack.length - 1] === true;
  }

  private resolveBinding(name: string): BindingKind | undefined {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const binding = this.scopes[index].get(name);
      if (binding !== undefined) {
        return binding;
      }
    }

    return undefined;
  }

  private collectModuleBindings(node: Module): Scope {
    const scope = this.collectBlockBindings(node.body);

    for (const statement of node.body) {
      if (statement.type === "ImportDeclaration") {
        this.mergeScope(scope, this.collectImportBindings(statement));
      }
    }

    return scope;
  }

  private collectBlockBindings(body: Statement[]): Scope {
    const scope = new Map<string, BindingKind>();

    for (const statement of body) {
      if (statement.type === "ClassDeclaration") scope.set(statement.id.name, "local");
      if (statement.type === "VariableDeclaration") {
        for (const declarator of statement.declarations) {
          this.collectBindingNamesFromPattern(declarator.id, scope);
        }
      }
    }

    return scope;
  }

  private collectImportBindings(node: ImportDeclaration): Scope {
    const scope = new Map<string, BindingKind>();

    for (const specifier of node.specifiers) {
      scope.set(specifier.local.name, this.getImportBindingKind(specifier));
    }

    return scope;
  }

  private getImportBindingKind(
    specifier: ImportDefaultSpecifier | ImportNamespaceSpecifier | ImportSpecifier
  ): BindingKind {
    return specifier.type === "ImportNamespaceSpecifier" ? "namespace" : "import";
  }

  private collectBindingNamesFromElement(
    node:
      | AssignmentPattern
      | ArrayPattern
      | Identifier
      | MemberExpression
      | ObjectPattern
      | RestElement,
    scope: Scope
  ): void {
    switch (node.type) {
      case "AssignmentPattern":
        this.collectBindingNamesFromPattern(node.left, scope);
        return;
      case "RestElement":
        this.collectBindingNamesFromPattern(node.argument, scope);
        return;
      default:
        this.collectBindingNamesFromPattern(node, scope);
        return;
    }
  }

  private collectBindingNamesFromPattern(
    node: ArrayPattern | Identifier | MemberExpression | ObjectPattern,
    scope: Scope
  ): void {
    switch (node.type) {
      case "Identifier":
        scope.set(node.name, "local");
        return;
      case "MemberExpression":
        return;
      case "ArrayPattern":
        for (const element of node.elements) {
          if (element !== null) {
            this.collectBindingNamesFromElement(element, scope);
          }
        }
        return;
      case "ObjectPattern":
        for (const property of node.properties) {
          if (property.type === "RestElement") {
            this.collectBindingNamesFromPattern(property.argument, scope);
            continue;
          }

          this.collectBindingNamesFromElement(property.value, scope);
        }
        return;
    }
  }

  private withScope(scope: Scope, callback: () => void): void {
    this.pushScope(scope);
    try {
      callback();
    } finally {
      this.popScope();
    }
  }

  private pushScope(scope: Scope): void {
    this.scopes.push(scope);
  }

  private popScope(): void {
    this.scopes.pop();
  }

  private mergeScope(target: Scope, source: Scope): void {
    for (const [name, binding] of source) {
      target.set(name, binding);
    }
  }
}
