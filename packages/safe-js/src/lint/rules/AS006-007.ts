import { visitClassElements } from "../class-elements.js";
import {
  type ClassNode,
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
  type ImportDeclaration,
  type ImportDefaultSpecifier,
  type ImportNamespaceSpecifier,
  type ImportSpecifier,
  type LogicalExpression,
  type MemberExpression,
  type Module,
  type NewExpression,
  type ObjectExpression,
  type ObjectPattern,
  type Property,
  type RestElement,
  type SourceSpan,
  type SpreadElement,
  type Statement,
  type SwitchStatement,
  type TemplateLiteral,
  type ThrowStatement,
  type TryStatement,
  type UnaryExpression,
  type VariableDeclaration,
  type VariableDeclarator,
  type WhileStatement
} from "../../parse/parser.js";
import { hoistedVarDeclarations } from "../../parse/bindings.js";

type DiagnosticCode = "AS006" | "AS007";

export type Diagnostic = {
  code: DiagnosticCode;
  severity: "warning";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

type BindingKind = "const" | "import" | "let" | "param" | "var";

type Binding = {
  code?: DiagnosticCode;
  kind: BindingKind;
  message: string;
  name: string;
  reads: number;
  span: SourceSpan;
};

type Scope = Map<string, Binding>;

export function AS006_007(source: string, options: { filename?: string } = {}): Diagnostic[] {
  return new AS006007Scanner(options.filename ?? "<input>").scan(source);
}

class AS006007Scanner {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly ignoredReads: Array<Set<Binding>> = [];
  private readonly scopes: Scope[] = [];

  constructor(private readonly filename: string) {}

  scan(source: string): Diagnostic[] {
    const module = parseModule(source, this.filename);
    this.visitModule(module);

    return this.diagnostics.sort(
      (left, right) =>
        left.span.start.offset - right.span.start.offset ||
        left.span.end.offset - right.span.end.offset ||
        left.code.localeCompare(right.code)
    );
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
      this.visitClass(node);
      return;
    }
    switch (node.type) {
      case "FunctionDeclaration":
        this.visitArrowFunction(node);
        return;
      case "ExportNamedDeclaration":
        this.visitVariableDeclaration(node.declaration);
        return;
      case "ExportDefaultDeclaration":
        if (node.declaration.type === "ClassDeclaration" || node.declaration.type === "FunctionDeclaration") this.visitStatement(node.declaration);
        else this.visitExpression(node.declaration);
        return;
      case "BlockStatement":
        this.visitBlock(node);
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
      case "SwitchStatement":
        this.visitSwitchStatement(node);
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
      case "ImportDeclaration":
      case "BreakStatement":
      case "ContinueStatement":
        return;
    }
  }

  private visitBlock(node: BlockStatement, functionBody = false): void {
    const bindings = this.collectBlockBindings(node.body);
    if (functionBody) {
      for (const declaration of hoistedVarDeclarations(node.body)) {
        bindings.push(...this.collectDeclarationBindings(declaration));
      }
    }
    this.withScope(bindings, () => {
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
      node.init?.type === "VariableDeclaration" && node.init.kind !== "var"
        ? this.collectDeclarationBindings(node.init)
        : [];

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
      node.left.type === "VariableDeclaration" && node.left.kind !== "var"
        ? this.collectDeclarationBindings(node.left)
        : [];

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
    this.visitBlock(node.block);
    if (node.handler !== undefined) {
      this.visitCatchClause(node.handler);
    }
    if (node.finalizer !== undefined) {
      this.visitBlock(node.finalizer);
    }
  }

  private visitCatchClause(node: CatchClause): void {
    this.withScope(this.collectCatchBindings(node), () => {
      if (node.param !== undefined) {
        this.visitBindingPattern(node.param);
      }
      this.visitBlock(node.body);
    });
  }

  private visitSwitchStatement(node: SwitchStatement): void {
    this.visitExpression(node.discriminant);
    const statements = node.cases.flatMap((switchCase) => switchCase.consequent);
    this.withScope(this.collectBlockBindings(statements), () => {
      for (const switchCase of node.cases) {
        if (switchCase.test !== undefined) this.visitExpression(switchCase.test);
        for (const statement of switchCase.consequent) this.visitStatement(statement);
      }
    });
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
    this.visitBindingPattern(node.id);
    const init = node.init;
    if (init !== undefined) {
      this.withIgnoredReads(this.resolveBindings(this.collectPatternBindingNames(node.id)), () => {
        this.visitExpression(init);
      });
    }
  }

  private visitClass(node: ClassNode): void {
    this.withScope(node.id === undefined ? [] : [this.createBinding(node.id, "param")], () => {
      visitClassElements(node, expression => this.visitExpression(expression), block => this.visitBlock(block, true));
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
      case "Identifier":
        this.markRead(node);
        return;
      case "FunctionExpression":
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
        this.visitBinaryExpression(node);
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
      case "NewExpression":
        this.visitCallExpression(node);
        return;
      case "SequenceExpression":
        for (const expression of node.expressions) this.visitExpression(expression);
        return;
      case "UpdateExpression":
        this.visitExpression(node.argument);
        return;
      case "TaggedTemplateExpression":
        this.visitExpression(node.tag);
        this.visitTemplateLiteral(node.quasi);
        return;
      case "TemplateLiteral":
        this.visitTemplateLiteral(node);
        return;
      case "BooleanLiteral":
      case "NullLiteral":
      case "NumericLiteral":
      case "StringLiteral":
      case "UndefinedLiteral":
        return;
    }
  }

  private visitArrowFunction(node: FunctionNode): void {
    this.withDeferredReads(() => {
      this.withScope(this.collectParameterBindings(node), () => {
        for (const parameter of node.params) {
          this.visitBindingElement(parameter);
        }

        if (node.body.type === "BlockStatement") {
          this.visitBlock(node.body, true);
          return;
        }

        this.visitExpression(node.body);
      });
    });
  }

  private visitAwaitExpression(node: AwaitExpression): void {
    this.visitExpression(node.argument);
  }

  private visitArrayExpression(node: ArrayExpression): void {
    for (const element of node.elements) {
      if (element?.type === "SpreadElement") {
        this.visitSpreadElement(element);
        continue;
      }
      if (element !== undefined) {
        this.visitExpression(element);
      }
    }
  }

  private visitObjectExpression(node: ObjectExpression): void {
    for (const property of node.properties) {
      if (property.type === "SpreadElement") {
        this.visitSpreadElement(property);
        continue;
      }
      this.visitProperty(property);
    }
  }

  private visitUnaryExpression(node: UnaryExpression): void {
    this.visitExpression(node.argument);
  }

  private visitBinaryExpression(node: BinaryExpression): void {
    this.visitExpression(node.left);
    this.visitExpression(node.right);
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
    if (node.computed) {
      this.visitExpression(node.property);
    }
  }

  private visitAssignmentExpression(node: AssignmentExpression): void {
    this.visitAssignmentTarget(node.left);
    this.visitExpression(node.right);
  }

  private visitCallExpression(node: CallExpression | NewExpression): void {
    this.visitExpression(node.callee);
    for (const argument of node.arguments) {
      if (argument.type === "SpreadElement") {
        this.visitSpreadElement(argument);
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
        this.visitBindingPattern(node.left);
        this.withIgnoredReads(
          this.resolveBindings(this.collectPatternBindingNames(node.left)),
          () => {
            this.visitExpression(node.right);
          }
        );
        return;
      case "RestElement":
        this.visitBindingPattern(node.argument);
        return;
      default:
        this.visitBindingPattern(node);
        return;
    }
  }

  private visitBindingPattern(
    node: ArrayPattern | Identifier | MemberExpression | ObjectPattern
  ): void {
    switch (node.type) {
      case "Identifier":
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
        return;
      case "ArrayPattern":
        for (const element of node.elements) {
          if (element !== null) {
            this.visitBindingElement(element);
          }
        }
        return;
      case "ObjectPattern":
        for (const property of node.properties) {
          if (property.type === "RestElement") {
            this.visitBindingPattern(property.argument);
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

  private visitAssignmentTarget(
    node: AssignmentExpression["left"] | AssignmentPattern | RestElement
  ): void {
    switch (node.type) {
      case "AssignmentPattern":
        this.visitAssignmentTarget(node.left);
        this.visitExpression(node.right);
        return;
      case "RestElement":
        this.visitAssignmentTarget(node.argument);
        return;
      case "Identifier":
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
        return;
      case "ArrayPattern":
        for (const element of node.elements) {
          if (element === null) {
            continue;
          }
          this.visitAssignmentTarget(element);
        }
        return;
      case "ObjectPattern":
        for (const property of node.properties) {
          if (property.type === "RestElement") {
            this.visitAssignmentTarget(property);
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

  private withScope(bindings: Binding[], visit: () => void): void {
    const scope: Scope = new Map();
    for (const binding of bindings) {
      scope.set(binding.name, binding);
    }

    this.scopes.push(scope);
    visit();
    this.reportUnreadBindings(scope);
    this.scopes.pop();
  }

  private reportUnreadBindings(scope: Scope): void {
    for (const binding of scope.values()) {
      if (binding.code === undefined || binding.reads > 0 || binding.name.startsWith("_")) {
        continue;
      }

      this.diagnostics.push({
        code: binding.code,
        severity: "warning",
        message: binding.message,
        filename: this.filename,
        line: binding.span.start.line,
        column: binding.span.start.column,
        span: binding.span
      });
    }
  }

  private markRead(node: Identifier): void {
    const binding = this.resolveBinding(node.name);
    if (binding !== undefined && !this.isIgnoredRead(binding)) {
      binding.reads += 1;
    }
  }

  private isIgnoredRead(binding: Binding): boolean {
    for (let index = this.ignoredReads.length - 1; index >= 0; index -= 1) {
      if (this.ignoredReads[index]?.has(binding)) {
        return true;
      }
    }
    return false;
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

  private collectModuleBindings(body: Statement[]): Binding[] {
    const bindings: Binding[] = [];
    for (const declaration of hoistedVarDeclarations(body)) {
      bindings.push(...this.collectDeclarationBindings(declaration));
    }

    for (const statement of body) {
      if (statement.type === "ExportDefaultDeclaration" && (statement.declaration.type === "FunctionDeclaration" || statement.declaration.type === "ClassDeclaration") && statement.declaration.id !== undefined) {
        bindings.push({ ...this.createBinding(statement.declaration.id, "let"), code: undefined });
        continue;
      }
      if (statement.type === "ImportDeclaration") {
        bindings.push(...this.collectImportBindings(statement));
        continue;
      }
      if ((statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") && statement.id !== undefined) {
        bindings.push(this.createBinding(statement.id, "let"));
        continue;
      }
      if (statement.type === "VariableDeclaration" && statement.kind !== "var") {
        bindings.push(...this.collectDeclarationBindings(statement));
        continue;
      }
      if (statement.type === "ExportNamedDeclaration") {
        bindings.push(...this.collectExportDeclarationBindings(statement.declaration));
      }
    }

    return bindings;
  }

  private collectBlockBindings(body: Statement[]): Binding[] {
    const bindings: Binding[] = [];

    for (const statement of body) {
      if ((statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") && statement.id !== undefined) {
        bindings.push(this.createBinding(statement.id, "let"));
      }
      if (statement.type === "VariableDeclaration" && statement.kind !== "var") {
        bindings.push(...this.collectDeclarationBindings(statement));
      }
    }

    return bindings;
  }

  private collectParameterBindings(node: FunctionNode): Binding[] {
    const bindings: Binding[] = [];

    if (node.type === "FunctionExpression" && node.id !== undefined) {
      bindings.push(this.createBinding(node.id, "param"));
    }

    for (const parameter of node.params) {
      this.collectBindingNamesFromElement(parameter, "param", bindings);
    }

    return bindings;
  }

  private collectDeclarationBindings(node: VariableDeclaration): Binding[] {
    const bindings: Binding[] = [];

    for (const declarator of node.declarations) {
      this.collectBindingNamesFromPattern(declarator.id, node.kind, bindings);
    }

    return bindings;
  }

  private collectExportDeclarationBindings(node: VariableDeclaration): Binding[] {
    return this.collectDeclarationBindings(node).map((binding) => ({
      ...binding,
      code: undefined
    }));
  }

  private collectCatchBindings(node: CatchClause): Binding[] {
    const bindings: Binding[] = [];

    if (node.param !== undefined) {
      this.collectBindingNamesFromPattern(node.param, "param", bindings);
    }

    return bindings;
  }

  private collectImportBindings(node: ImportDeclaration): Binding[] {
    return node.specifiers.map((specifier) => this.createImportBinding(specifier));
  }

  private createImportBinding(
    specifier: ImportDefaultSpecifier | ImportNamespaceSpecifier | ImportSpecifier
  ): Binding {
    return {
      kind: "import",
      message: `Import '${specifier.local.name}' is never referenced.`,
      name: specifier.local.name,
      reads: 0,
      span: specifier.local.span
    };
  }

  private collectBindingNamesFromElement(
    node:
      | AssignmentPattern
      | ArrayPattern
      | Identifier
      | MemberExpression
      | ObjectPattern
      | RestElement,
    kind: BindingKind,
    bindings: Binding[]
  ): void {
    switch (node.type) {
      case "AssignmentPattern":
        this.collectBindingNamesFromPattern(node.left, kind, bindings);
        return;
      case "RestElement":
        this.collectBindingNamesFromPattern(node.argument, kind, bindings);
        return;
      default:
        this.collectBindingNamesFromPattern(node, kind, bindings);
        return;
    }
  }

  private collectBindingNamesFromPattern(
    node: ArrayPattern | Identifier | MemberExpression | ObjectPattern,
    kind: BindingKind,
    bindings: Binding[]
  ): void {
    switch (node.type) {
      case "Identifier":
        bindings.push(this.createBinding(node, kind));
        return;
      case "MemberExpression":
        return;
      case "ArrayPattern":
        for (const element of node.elements) {
          if (element !== null) {
            this.collectBindingNamesFromElement(element, kind, bindings);
          }
        }
        return;
      case "ObjectPattern":
        for (const property of node.properties) {
          if (property.type === "RestElement") {
            this.collectBindingNamesFromPattern(property.argument, kind, bindings);
            continue;
          }
          this.collectBindingNamesFromElement(property.value, kind, bindings);
        }
        return;
    }
  }

  private createBinding(node: Identifier, kind: BindingKind): Binding {
    return {
      code: kind === "const" || kind === "let" ? "AS007" : undefined,
      kind,
      message: `Binding '${node.name}' is declared but never read.`,
      name: node.name,
      reads: 0,
      span: node.span
    };
  }

  private collectPatternBindingNames(
    node: ArrayPattern | Identifier | MemberExpression | ObjectPattern
  ): string[] {
    const names: string[] = [];
    this.collectBindingNames(node, names);
    return names;
  }

  private collectBindingNames(
    node:
      | AssignmentPattern
      | ArrayPattern
      | Identifier
      | MemberExpression
      | ObjectPattern
      | RestElement,
    names: string[]
  ): void {
    switch (node.type) {
      case "AssignmentPattern":
        this.collectBindingNames(node.left, names);
        return;
      case "RestElement":
        this.collectBindingNames(node.argument, names);
        return;
      case "Identifier":
        names.push(node.name);
        return;
      case "MemberExpression":
        return;
      case "ArrayPattern":
        for (const element of node.elements) {
          if (element !== null) {
            this.collectBindingNames(element, names);
          }
        }
        return;
      case "ObjectPattern":
        for (const property of node.properties) {
          this.collectBindingNames(
            property.type === "RestElement" ? property.argument : property.value,
            names
          );
        }
        return;
    }
  }

  private resolveBindings(names: string[]): Binding[] {
    return names.flatMap((name) => {
      const binding = this.resolveBinding(name);
      return binding === undefined ? [] : [binding];
    });
  }

  private withIgnoredReads(bindings: Binding[], visit: () => void): void {
    if (bindings.length === 0) {
      visit();
      return;
    }

    this.ignoredReads.push(new Set(bindings));
    visit();
    this.ignoredReads.pop();
  }

  private withDeferredReads(visit: () => void): void {
    const ignoredReads = this.ignoredReads.splice(0);
    visit();
    this.ignoredReads.push(...ignoredReads);
  }
}
