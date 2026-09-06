import { visitClassElements } from "../class-elements.js";
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
  code: "AS010";
  severity: "warning";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

type Candidate = {
  kind: "candidate";
  name: string;
  reads: number;
  reassignments: number;
  span: SourceSpan;
};

type ScopeEntry = Candidate | "import" | "local" | "namespace";
type Scope = Map<string, ScopeEntry>;

export function AS010(source: string, options: { filename?: string } = {}): Diagnostic[] {
  return new AS010Scanner(options.filename ?? "<input>").scan(source);
}

class AS010Scanner {
  private readonly candidates: Candidate[] = [];
  private readonly ignoredReads: Array<Set<Candidate>> = [];
  private readonly scopes: Scope[] = [];

  constructor(private readonly filename: string) {}

  scan(source: string): Diagnostic[] {
    const module = parseModule(source, this.filename);
    const moduleScope = this.collectModuleBindings(module.body);

    this.withScope(moduleScope, () => {
      this.collectCandidates(module.body, moduleScope);
    });

    this.withScope(moduleScope, () => {
      this.visitModule(module);
    });

    return this.candidates
      .filter((candidate) => candidate.reads === 0 && candidate.reassignments === 0)
      .map((candidate) => ({
        code: "AS010" as const,
        severity: "warning" as const,
        message: `Top-level let '${candidate.name}' stores a host call result but is never read again.`,
        filename: this.filename,
        line: candidate.span.start.line,
        column: candidate.span.start.column,
        span: candidate.span
      }));
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

  private visitBlock(node: BlockStatement): void {
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
    const scope =
      node.init?.type === "VariableDeclaration"
        ? this.collectDeclarationBindings(node.init)
        : new Map();

    this.withScope(scope, () => {
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
    const scope =
      node.left.type === "VariableDeclaration"
        ? this.collectDeclarationBindings(node.left)
        : new Map();

    this.withScope(scope, () => {
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
    if (node.init === undefined) {
      return;
    }
    const init = node.init;

    this.withIgnoredReads(this.resolveCandidates(this.collectPatternBindingNames(node.id)), () => {
      this.visitExpression(init);
    });
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
        this.visitCallExpression(node);
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
    const scope = this.collectParameterBindings(node);

    if (node.body.type === "BlockStatement") {
      this.mergeScope(scope, this.collectBlockBindings(node.body.body));
    }

    this.withScope(scope, () => {
      for (const parameter of node.params) {
        this.visitBindingElement(parameter);
      }

      if (node.body.type === "BlockStatement") {
        for (const statement of node.body.body) {
          this.visitStatement(statement);
        }
        return;
      }

      this.visitExpression(node.body);
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

  private visitCallExpression(node: CallExpression): void {
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
          this.resolveCandidates(this.collectPatternBindingNames(node.left)),
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
        this.markReassignment(node);
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
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

  private markRead(node: Identifier): void {
    const candidate = this.resolveCandidate(node.name);
    if (candidate !== undefined && !this.isIgnoredRead(candidate)) {
      candidate.reads += 1;
    }
  }

  private markReassignment(node: Identifier): void {
    const candidate = this.resolveCandidate(node.name);
    if (candidate !== undefined) {
      candidate.reassignments += 1;
    }
  }

  private isIgnoredRead(candidate: Candidate): boolean {
    for (let index = this.ignoredReads.length - 1; index >= 0; index -= 1) {
      if (this.ignoredReads[index]?.has(candidate)) {
        return true;
      }
    }
    return false;
  }

  private resolveCandidate(name: string): Candidate | undefined {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const entry = this.scopes[index]?.get(name);
      if (entry === undefined) {
        continue;
      }
      return typeof entry === "object" && entry.kind === "candidate" ? entry : undefined;
    }
    return undefined;
  }

  private collectModuleBindings(body: Statement[]): Scope {
    const scope: Scope = new Map();

    for (const statement of body) {
      if (statement.type === "ImportDeclaration") {
        this.mergeScope(scope, this.collectImportBindings(statement));
        continue;
      }

      if (statement.type === "VariableDeclaration") {
        this.mergeScope(scope, this.collectDeclarationBindings(statement));
        continue;
      }

      if (statement.type === "ExportNamedDeclaration") {
        this.mergeScope(scope, this.collectDeclarationBindings(statement.declaration));
      }
    }

    return scope;
  }

  private collectCandidates(body: Statement[], scope: Scope): void {
    for (const statement of body) {
      if (statement.type !== "VariableDeclaration" || statement.kind !== "let") {
        continue;
      }

      for (const declarator of statement.declarations) {
        if (declarator.id.type !== "Identifier") {
          continue;
        }

        const hostCall = this.findHostCall(declarator.init);
        if (hostCall === undefined || !this.isHostCall(hostCall)) {
          continue;
        }

        const candidate: Candidate = {
          kind: "candidate",
          name: declarator.id.name,
          reads: 0,
          reassignments: 0,
          span: declarator.id.span
        };

        this.candidates.push(candidate);
        scope.set(candidate.name, candidate);
      }
    }
  }

  private collectBlockBindings(body: Statement[]): Scope {
    const scope: Scope = new Map();

    for (const statement of body) {
      if (statement.type === "VariableDeclaration") {
        this.mergeScope(scope, this.collectDeclarationBindings(statement));
      }
    }

    return scope;
  }

  private collectParameterBindings(node: FunctionNode): Scope {
    const scope: Scope = new Map();

    for (const parameter of node.params) {
      this.collectBindingNamesFromElement(parameter, scope);
    }

    return scope;
  }

  private collectDeclarationBindings(node: VariableDeclaration): Scope {
    const scope: Scope = new Map();

    for (const declarator of node.declarations) {
      this.collectBindingNamesFromPattern(declarator.id, scope);
    }

    return scope;
  }

  private collectCatchBindings(node: CatchClause): Scope {
    const scope: Scope = new Map();

    if (node.param !== undefined) {
      this.collectBindingNamesFromPattern(node.param, scope);
    }

    return scope;
  }

  private collectImportBindings(node: ImportDeclaration): Scope {
    const scope: Scope = new Map();

    for (const specifier of node.specifiers) {
      scope.set(specifier.local.name, this.getImportBindingKind(specifier));
    }

    return scope;
  }

  private getImportBindingKind(
    specifier: ImportDefaultSpecifier | ImportNamespaceSpecifier | ImportSpecifier
  ): ScopeEntry {
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

  private resolveCandidates(names: string[]): Candidate[] {
    return names.flatMap((name) => {
      const candidate = this.resolveCandidate(name);
      return candidate === undefined ? [] : [candidate];
    });
  }

  private withIgnoredReads(candidates: Candidate[], visit: () => void): void {
    if (candidates.length === 0) {
      visit();
      return;
    }

    this.ignoredReads.push(new Set(candidates));
    try {
      visit();
    } finally {
      this.ignoredReads.pop();
    }
  }

  private withScope(scope: Scope, visit: () => void): void {
    this.scopes.push(scope);
    try {
      visit();
    } finally {
      this.scopes.pop();
    }
  }

  private mergeScope(target: Scope, source: Scope): void {
    for (const [name, binding] of source) {
      target.set(name, binding);
    }
  }

  private findHostCall(node: Expression | undefined): CallExpression | undefined {
    if (node === undefined) {
      return undefined;
    }

    if (node.type === "CallExpression") {
      return node;
    }

    if (node.type === "AwaitExpression" && node.argument.type === "CallExpression") {
      return node.argument;
    }

    return undefined;
  }

  private isHostCall(node: CallExpression): boolean {
    const root = this.findRootIdentifier(node.callee);
    if (root === undefined) {
      return false;
    }

    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const binding = this.scopes[index]?.get(root.name);
      if (binding === undefined) {
        continue;
      }
      return binding === "import" || binding === "namespace";
    }

    return false;
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
}
