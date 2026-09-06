import { visitClassElements } from "../class-elements.js";
import {
  parseModule,
  type ArrayExpression,
  type ArrayPattern,
  type FunctionNode,
  type AssignmentExpression,
  type AssignmentPattern,
  type AssignmentProperty,
  type AssignmentTarget,
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
  type Identifier,
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
import { normalizeModuleRegistrations, type Modules } from "./module-registry.js";

export type Diagnostic = {
  code: "AS-FLOATING-PROMISE";
  severity: "warning";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

type AsyncImportBinding = {
  async: boolean;
  kind: "import";
  name: string;
};

type LocalBinding = {
  async: boolean;
  kind: "local";
  name: string;
};

type NamespaceImportBinding = {
  kind: "namespace-import";
  moduleName: string;
  name: string;
};

type Binding = AsyncImportBinding | LocalBinding | NamespaceImportBinding;
type Scope = Map<string, Binding>;

const AS_FLOATING_PROMISE_MESSAGE =
  "Promise-returning call is not awaited, returned, stored, or chained.";

const PROMISE_CONSUMERS = new Set(["all", "allSettled", "any", "race"]);
const PROMISE_FACTORIES = new Set(["reject", "resolve"]);
const PROMISE_CHAIN_METHODS = new Set(["then"]);

export function AS_FLOATING_PROMISE(
  source: string,
  options: { filename?: string; modules?: Modules } = {}
): Diagnostic[] {
  return new ASFloatingPromiseScanner(options.filename ?? "<input>", options.modules).scan(source);
}

class ASFloatingPromiseScanner {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly moduleRegistrations;
  private readonly scopes: Scope[] = [];

  constructor(
    private readonly filename: string,
    modules: Modules | undefined
  ) {
    this.moduleRegistrations = normalizeModuleRegistrations(modules);
  }

  scan(source: string): Diagnostic[] {
    this.visitModule(parseModule(source, this.filename));
    return this.diagnostics;
  }

  private visitModule(node: Module): void {
    this.withScope(this.collectModuleBindings(node.body), () => {
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
        this.reportUnhandledLikelyPromiseStatementExpression(node.expression);
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
    this.withScope(this.collectBlockBindings(node.body), () => {
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
    const bindings = node.param === undefined ? [] : this.collectPatternBindings(node.param);

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
    this.visitBindingPattern(node.id);
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

  private visitAssignmentTarget(node: AssignmentTarget | PatternTarget): void {
    switch (node.type) {
      case "ArrayPattern":
      case "ObjectPattern":
        this.visitBindingPattern(node);
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
        return;
      case "Identifier":
      case "MetaProperty":
        return;
    }
  }

  private visitBindingPattern(node: ArrayPattern | Identifier | ObjectPattern): void {
    switch (node.type) {
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
      case "Identifier":
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

  private isUnhandledLikelyPromiseExpression(node: Expression): boolean {
    if (node.type !== "CallExpression") {
      return false;
    }

    if (this.isPromiseConsumerCall(node) || this.isPromiseChainCall(node)) {
      return false;
    }

    return this.isLikelyPromiseCall(node);
  }

  private reportUnhandledLikelyPromiseStatementExpression(node: Expression): void {
    if (this.isUnhandledLikelyPromiseExpression(node)) {
      this.report(node.span);
      return;
    }

    switch (node.type) {
      case "LogicalExpression":
        this.reportUnhandledLikelyPromiseStatementExpression(node.left);
        this.reportUnhandledLikelyPromiseStatementExpression(node.right);
        return;
      case "ConditionalExpression":
        this.reportUnhandledLikelyPromiseStatementExpression(node.consequent);
        this.reportUnhandledLikelyPromiseStatementExpression(node.alternate);
        return;
      case "CallExpression":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "AwaitExpression":
      case "ArrayExpression":
      case "ObjectExpression":
      case "UnaryExpression":
      case "BinaryExpression":
      case "MemberExpression":
      case "AssignmentExpression":
      case "TemplateLiteral":
      case "TaggedTemplateExpression":
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

  private isLikelyPromiseCall(node: CallExpression): boolean {
    if (node.callee.type === "ArrowFunctionExpression") {
      return node.callee.async;
    }

    if (node.callee.type === "Identifier") {
      return this.resolveAsyncFunctionBinding(node.callee.name);
    }

    if (node.callee.type !== "MemberExpression") {
      return false;
    }

    if (this.isPromiseFactoryCall(node)) {
      return true;
    }

    return this.isAsyncNamespaceMemberCall(node.callee);
  }

  private isPromiseConsumerCall(node: CallExpression): boolean {
    return this.isPromiseStaticMethodCall(node, PROMISE_CONSUMERS);
  }

  private isPromiseFactoryCall(node: CallExpression): boolean {
    return this.isPromiseStaticMethodCall(node, PROMISE_FACTORIES);
  }

  private isPromiseStaticMethodCall(
    node: CallExpression,
    methodNames: ReadonlySet<string>
  ): boolean {
    const member = node.callee.type === "MemberExpression" ? node.callee : undefined;
    return (
      member !== undefined &&
      !member.computed &&
      member.object.type === "Identifier" &&
      member.object.name === "Promise" &&
      member.property.type === "Identifier" &&
      methodNames.has(member.property.name)
    );
  }

  private isPromiseChainCall(node: CallExpression): boolean {
    const member = node.callee.type === "MemberExpression" ? node.callee : undefined;
    return (
      member !== undefined &&
      !member.computed &&
      member.property.type === "Identifier" &&
      PROMISE_CHAIN_METHODS.has(member.property.name) &&
      this.isLikelyPromiseExpression(member.object)
    );
  }

  private isLikelyPromiseExpression(node: Expression): boolean {
    return node.type === "CallExpression" && this.isLikelyPromiseCall(node);
  }

  private resolveAsyncFunctionBinding(name: string): boolean {
    const binding = this.resolveBinding(name);
    return (binding?.kind === "import" || binding?.kind === "local") && binding.async === true;
  }

  private isAsyncNamespaceMemberCall(member: MemberExpression): boolean {
    if (
      member.computed ||
      member.object.type !== "Identifier" ||
      member.property.type !== "Identifier"
    ) {
      return false;
    }

    const binding = this.resolveBinding(member.object.name);
    if (binding?.kind !== "namespace-import") {
      return false;
    }

    return (
      this.moduleRegistrations.get(binding.moduleName)?.asyncExports.has(member.property.name) ===
      true
    );
  }

  private collectModuleBindings(statements: readonly Statement[]): Binding[] {
    return [
      ...statements.flatMap((statement): Binding[] => {
        if (statement.type !== "ImportDeclaration") {
          return [];
        }

        return statement.specifiers.flatMap((specifier): Binding[] => {
          if (specifier.type === "ImportNamespaceSpecifier") {
            return [
              {
                kind: "namespace-import",
                moduleName: statement.source.value,
                name: specifier.local.name
              }
            ];
          }

          const exportName =
            specifier.type === "ImportDefaultSpecifier" ? "default" : specifier.imported.name;

          return [
            {
              async:
                this.moduleRegistrations
                  .get(statement.source.value)
                  ?.asyncExports.has(exportName) === true,
              kind: "import",
              name: specifier.local.name
            }
          ];
        });
      }),
      ...this.collectBlockBindings(statements)
    ];
  }

  private collectBlockBindings(statements: readonly Statement[]): Binding[] {
    return statements.flatMap((statement) => {
      if (statement.type === "FunctionDeclaration") {
        return [
          { async: statement.async && !statement.generator, kind: "local", name: statement.id.name }
        ];
      }
      if (statement.type === "VariableDeclaration") {
        return this.collectDeclarationBindings(statement);
      }

      if (statement.type === "ExportNamedDeclaration") {
        return this.collectDeclarationBindings(statement.declaration);
      }

      return [];
    });
  }

  private collectDeclarationBindings(node: VariableDeclaration): Binding[] {
    return node.declarations.flatMap((declarator) =>
      this.collectDeclaratorBindings(declarator).map((name) => ({
        async:
          (declarator.init?.type === "ArrowFunctionExpression" ||
            (declarator.init?.type === "FunctionExpression" && !declarator.init.generator)) &&
          declarator.init.async,
        kind: "local" as const,
        name
      }))
    );
  }

  private collectDeclaratorBindings(node: VariableDeclarator): string[] {
    return this.collectPatternBindingNames(node.id);
  }

  private collectArrowFunctionBindings(node: FunctionNode): Binding[] {
    const bindings: Binding[] = node.params.flatMap((param) =>
      this.collectParameterBindingNames(param).map((name) => ({
        async: false,
        kind: "local" as const,
        name
      }))
    );
    if (node.type === "FunctionExpression" && node.id !== undefined) {
      bindings.unshift({ async: node.async && !node.generator, kind: "local", name: node.id.name });
    }
    return bindings;
  }

  private collectPatternBindings(node: ArrayPattern | Identifier | ObjectPattern): Binding[] {
    return this.collectPatternBindingNames(node).map((name) => ({
      async: false,
      kind: "local" as const,
      name
    }));
  }

  private collectParameterBindingNames(
    node: AssignmentPattern | ArrayPattern | Identifier | ObjectPattern | RestElement
  ): string[] {
    switch (node.type) {
      case "AssignmentPattern":
        return this.collectPatternBindingNames(node.left);
      case "RestElement":
        return this.collectPatternBindingNames(node.argument);
      case "ArrayPattern":
      case "ObjectPattern":
      case "Identifier":
        return this.collectPatternBindingNames(node);
    }
  }

  private collectPatternBindingNames(
    node: ArrayPattern | Identifier | ObjectPattern | PatternTarget
  ): string[] {
    switch (node.type) {
      case "Identifier":
        return [node.name];
      case "ArrayPattern":
        return node.elements.flatMap((element) => {
          if (element === null) {
            return [];
          }

          return this.collectBindingElementNames(element);
        });
      case "ObjectPattern":
        return node.properties.flatMap((property) => {
          if (property.type === "RestElement") {
            return this.collectBindingElementNames(property);
          }

          return this.collectBindingElementNames(property.value);
        });
      case "MemberExpression":
        return [];
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
      case "AssignmentPattern":
        return this.collectPatternBindingNames(node.left);
      case "RestElement":
        return this.collectPatternBindingNames(node.argument);
      case "ArrayPattern":
      case "ObjectPattern":
      case "Identifier":
        return this.collectPatternBindingNames(node);
      case "MemberExpression":
        return [];
    }
  }

  private resolveBinding(name: string): Binding | undefined {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const binding = this.scopes[index]?.get(name);
      if (binding !== undefined) {
        return binding;
      }
    }

    return undefined;
  }

  private withScope(bindings: readonly Binding[], callback: () => void): void {
    this.scopes.push(new Map(bindings.map((binding) => [binding.name, binding])));
    try {
      callback();
    } finally {
      this.scopes.pop();
    }
  }

  private report(span: SourceSpan): void {
    this.diagnostics.push({
      code: "AS-FLOATING-PROMISE",
      severity: "warning",
      message: AS_FLOATING_PROMISE_MESSAGE,
      filename: this.filename,
      line: span.start.line,
      column: span.start.column,
      span
    });
  }
}
