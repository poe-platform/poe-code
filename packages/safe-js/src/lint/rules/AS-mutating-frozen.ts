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
  code: "AS-MUTATING-FROZEN";
  severity: "warning";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

type FrozenState = "frozen" | "unknown";
type Scope = Map<string, FrozenState>;

const MUTATING_ARRAY_METHODS = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift"
]);

export function AS_MUTATING_FROZEN(
  source: string,
  options: { filename?: string } = {}
): Diagnostic[] {
  return new ASMutatingFrozenScanner(options.filename ?? "<input>").scan(source);
}

class ASMutatingFrozenScanner {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly scopes: Scope[] = [];

  constructor(private readonly filename: string) {}

  scan(source: string): Diagnostic[] {
    this.visitModule(parseModule(source, this.filename));
    return this.diagnostics;
  }

  private visitModule(node: Module): void {
    this.withScope(this.collectStatementBindings(node.body), () => {
      for (const statement of node.body) {
        this.visitStatement(statement);
      }
    });
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
    this.withScope(this.collectStatementBindings(node.body), () => {
      for (const statement of node.body) {
        this.visitStatement(statement);
      }
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
    const bindings =
      node.init?.type === "VariableDeclaration" ? this.collectDeclarationBindings(node.init) : [];

    this.withScope(bindings, () => {
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
    });
  }

  private visitForOfStatement(node: ForInStatement | ForOfStatement): void {
    const bindings =
      node.left.type === "VariableDeclaration" ? this.collectDeclarationBindings(node.left) : [];

    this.withScope(bindings, () => {
      if (node.left.type === "VariableDeclaration") {
        this.visitVariableDeclaration(node.left);
      } else {
        this.visitAssignmentTarget(node.left);
      }
      this.visitExpression(node.right);
      this.visitStatement(node.body);
    });
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
    const bindings =
      node.param === undefined
        ? []
        : this.createUnknownBindings(this.collectPatternBindings(node.param));

    this.withScope(bindings, () => {
      this.visitBlockStatement(node.body);
    });
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

    if (node.id.type !== "Identifier") {
      this.visitBindingPattern(node.id);
      return;
    }

    this.setBinding(
      node.id.name,
      isImmutableArrayOrigin(
        node.init,
        (name) => this.lookup(name),
        (name) => this.isBound(name)
      )
    );
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
    this.withScope(this.collectArrowFunctionBindings(node), () => {
      if (node.body.type === "BlockStatement") {
        this.visitBlockStatement(node.body);
        return;
      }

      this.visitExpression(node.body);
    });
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
    this.visitAssignmentTarget(node.left);
    this.visitExpression(node.right);

    if (node.left.type === "Identifier" && node.operator === "=") {
      this.setBinding(
        node.left.name,
        isImmutableArrayOrigin(
          node.right,
          (name) => this.lookup(name),
          (name) => this.isBound(name)
        )
      );
    }
  }

  private visitCallExpression(node: CallExpression): void {
    if (
      isMutatingFrozenCall(
        node,
        (name) => this.lookup(name),
        (name) => this.isBound(name)
      )
    ) {
      const methodName = getCalledMethodName(node);
      this.report(node.span, methodName ?? "method");
    }

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

  private visitAssignmentTarget(node: AssignmentExpression["left"] | PatternTarget): void {
    switch (node.type) {
      case "Identifier":
      case "MetaProperty":
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
        return;
      case "ArrayPattern":
      case "ObjectPattern":
        this.visitBindingPattern(node);
        return;
    }
  }

  private visitBindingPattern(node: ArrayPattern | Identifier | ObjectPattern): void {
    switch (node.type) {
      case "Identifier":
        return;
      case "ArrayPattern":
        for (const element of node.elements) {
          if (element === null) {
            continue;
          }

          this.visitBindingElement(element);
        }
        return;
      case "ObjectPattern":
        for (const property of node.properties) {
          if (property.type === "RestElement") {
            this.visitBindingElement(property);
            continue;
          }

          this.visitAssignmentProperty(property);
        }
        return;
    }
  }

  private visitAssignmentProperty(node: AssignmentProperty): void {
    if (node.computed) {
      this.visitExpression(node.key);
    }
    this.visitBindingElement(node.value);
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
        this.visitAssignmentTarget(node.left);
        this.visitExpression(node.right);
        return;
      case "RestElement":
        this.visitAssignmentTarget(node.argument);
        return;
      case "ArrayPattern":
      case "ObjectPattern":
      case "Identifier":
        this.visitBindingPattern(node);
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
        return;
    }
  }

  private collectStatementBindings(statements: readonly Statement[]): Array<[string, FrozenState]> {
    return statements.flatMap((statement) => {
      if (statement.type === "VariableDeclaration") {
        return this.collectDeclarationBindings(statement);
      }

      if (statement.type === "ExportNamedDeclaration") {
        return this.collectDeclarationBindings(statement.declaration);
      }

      if (statement.type === "ImportDeclaration") {
        return statement.specifiers.map((specifier): [string, FrozenState] => [
          specifier.local.name,
          "unknown"
        ]);
      }

      return [];
    });
  }

  private collectDeclarationBindings(node: VariableDeclaration): Array<[string, FrozenState]> {
    return node.declarations.flatMap((declarator) =>
      this.createUnknownBindings(this.collectPatternBindings(declarator.id))
    );
  }

  private collectArrowFunctionBindings(node: FunctionNode): Array<[string, FrozenState]> {
    return node.params.flatMap((param) =>
      this.createUnknownBindings(this.collectBindingElementNames(param))
    );
  }

  private createUnknownBindings(names: readonly string[]): Array<[string, FrozenState]> {
    return names.map((name) => [name, "unknown"]);
  }

  private collectPatternBindings(node: ArrayPattern | Identifier | ObjectPattern): string[] {
    switch (node.type) {
      case "Identifier":
        return [node.name];
      case "ArrayPattern":
        return node.elements.flatMap((element) =>
          element === null ? [] : this.collectBindingElementNames(element)
        );
      case "ObjectPattern":
        return node.properties.flatMap((property) =>
          property.type === "RestElement"
            ? this.collectBindingElementNames(property)
            : this.collectBindingElementNames(property.value)
        );
    }
  }

  private collectBindingElementNames(
    node:
      | AssignmentPattern
      | ArrayPattern
      | Identifier
      | MemberExpression
      | ObjectPattern
      | RestElement
  ): string[] {
    switch (node.type) {
      case "Identifier":
        return [node.name];
      case "AssignmentPattern":
        return this.collectBindingElementNames(node.left);
      case "RestElement":
        return this.collectBindingElementNames(node.argument);
      case "ArrayPattern":
      case "ObjectPattern":
        return this.collectPatternBindings(node);
      case "MemberExpression":
        return [];
    }
  }

  private withScope(bindings: Array<[string, FrozenState]>, callback: () => void): void {
    this.scopes.push(new Map(bindings));
    try {
      callback();
    } finally {
      this.scopes.pop();
    }
  }

  private lookup(name: string): FrozenState {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const binding = this.scopes[index].get(name);
      if (binding !== undefined) {
        return binding;
      }
    }

    return "unknown";
  }

  private isBound(name: string): boolean {
    return this.scopes.some((scope) => scope.has(name));
  }

  private setBinding(name: string, state: FrozenState): void {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const scope = this.scopes[index];
      if (scope.has(name)) {
        scope.set(name, state);
        return;
      }
    }
  }

  private report(span: SourceSpan, methodName: string): void {
    this.diagnostics.push({
      code: "AS-MUTATING-FROZEN",
      severity: "warning",
      message: `Mutating array method '${methodName}' cannot be called on an immutable array.`,
      filename: this.filename,
      line: span.start.line,
      column: span.start.column,
      span
    });
  }
}

function isMutatingFrozenCall(
  node: CallExpression,
  lookup: (name: string) => FrozenState,
  isBound: (name: string) => boolean
): boolean {
  const methodName = getCalledMethodName(node);

  return (
    methodName !== undefined &&
    MUTATING_ARRAY_METHODS.has(methodName) &&
    node.callee.type === "MemberExpression" &&
    isImmutableArrayOrigin(node.callee.object, lookup, isBound) === "frozen"
  );
}

function getCalledMethodName(node: CallExpression): string | undefined {
  if (node.callee.type !== "MemberExpression") {
    return undefined;
  }

  if (!node.callee.computed) {
    return node.callee.property.type === "Identifier" ? node.callee.property.name : undefined;
  }

  return node.callee.property.type === "StringLiteral" ? node.callee.property.value : undefined;
}

function isImmutableArrayOrigin(
  node: Expression | undefined,
  lookup: (name: string) => FrozenState,
  isBound: (name: string) => boolean
): FrozenState {
  if (node === undefined) {
    return "unknown";
  }

  if (node.type === "Identifier") {
    return lookup(node.name);
  }

  return isImmutableArrayFactoryCall(node, isBound) ? "frozen" : "unknown";
}

function isImmutableArrayFactoryCall(
  node: Expression,
  isBound: (name: string) => boolean
): boolean {
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") {
    return false;
  }

  if (node.callee.computed) {
    return false;
  }

  const objectName = node.callee.object.type === "Identifier" ? node.callee.object.name : undefined;
  const propertyName =
    node.callee.property.type === "Identifier" ? node.callee.property.name : undefined;

  return (
    (objectName === "Object" && propertyName === "freeze" && !isBound(objectName)) ||
    (objectName === "Array" && propertyName === "of" && !isBound(objectName))
  );
}
