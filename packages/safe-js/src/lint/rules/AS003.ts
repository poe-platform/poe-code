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
  type ExpressionStatement,
  type ForInStatement,
  type ForOfStatement,
  type ForStatement,
  type Identifier,
  type IfStatement,
  type ImportDeclaration,
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
import { KNOWN_RUNTIME_GLOBALS } from "./known-globals.js";
import { hoistedVarDeclarations } from "../../parse/bindings.js";

export type Diagnostic = {
  code: "AS003";
  severity: "error";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

type BindingKind = "const" | "import" | "let" | "param" | "var";

type Binding = {
  kind: BindingKind;
  name: string;
};

type Scope = Map<string, Binding>;

export function AS003(
  source: string,
  options: { allowedGlobals?: readonly string[]; filename?: string } = {}
): Diagnostic[] {
  return new AS003Scanner(
    options.filename ?? "<input>",
    new Set([...KNOWN_RUNTIME_GLOBALS, ...(options.allowedGlobals ?? [])])
  ).scan(source);
}

class AS003Scanner {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly scopes: Scope[] = [];

  constructor(
    private readonly filename: string,
    private readonly allowedGlobals: ReadonlySet<string>
  ) {}

  scan(source: string): Diagnostic[] {
    const module = parseModule(source, this.filename);
    this.visitModule(module);
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
      this.visitClass(node);
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
        this.visitExpressionStatement(node);
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

  private visitExpressionStatement(node: ExpressionStatement): void {
    this.visitExpression(node.expression);
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

  private visitSwitchStatement(node: SwitchStatement): void {
    this.visitExpression(node.discriminant);
    this.withScope(
      this.collectBlockBindings(node.cases.flatMap((switchCase) => switchCase.consequent)),
      () => {
        for (const switchCase of node.cases) {
          if (switchCase.test !== undefined) this.visitExpression(switchCase.test);
          for (const statement of switchCase.consequent) this.visitStatement(statement);
        }
      }
    );
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
    if (node.init !== undefined) {
      this.visitExpression(node.init);
    }
  }

  private visitClass(node: ClassNode): void {
    this.withScope(node.id === undefined ? [] : [{ kind: "const", name: node.id.name }], () => {
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
        this.visitIdentifier(node);
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
    this.withScope(this.collectParameterBindings(node), () => {
      for (const parameter of node.params) {
        this.visitBindingElement(parameter);
      }

      if (node.body.type === "BlockStatement") {
        this.visitBlock(node.body, true);
      } else {
        this.visitExpression(node.body);
      }
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
        this.visitExpression(node.right);
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
        this.visitIdentifier(node);
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

  private visitIdentifier(node: Identifier): void {
    if (this.resolveBinding(node.name) !== undefined) {
      return;
    }

    if (this.allowedGlobals.has(node.name)) {
      return;
    }

    const visibleNames = this.collectVisibleNames();
    const nearMatches = this.collectSuggestionNames(visibleNames)
      .map((name) => ({ distance: getLevenshteinDistance(node.name, name), name }))
      .filter((entry) => entry.distance <= 2)
      .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
      .map((entry) => entry.name);

    const message =
      nearMatches.length > 0
        ? `Unknown identifier '${node.name}'. ${formatNearMatchMessage(nearMatches)}`
        : `Unknown identifier '${node.name}'. ${formatVisibleNamesMessage(visibleNames)}`;

    this.diagnostics.push({
      code: "AS003",
      severity: "error",
      message,
      filename: this.filename,
      line: node.span.start.line,
      column: node.span.start.column,
      span: node.span
    });
  }

  private withScope(bindings: Binding[], visit: () => void): void {
    const scope: Scope = new Map();
    for (const binding of bindings) {
      scope.set(binding.name, binding);
    }
    this.scopes.push(scope);
    visit();
    this.scopes.pop();
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

  private collectVisibleNames(): string[] {
    const names = new Set<string>();

    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      for (const name of this.scopes[index]?.keys() ?? []) {
        names.add(name);
      }
    }

    return [...names].sort((left, right) => left.localeCompare(right));
  }

  private collectSuggestionNames(visibleNames: readonly string[]): string[] {
    const names = new Set([...visibleNames, ...this.allowedGlobals]);
    return [...names].sort((left, right) => left.localeCompare(right));
  }

  private collectModuleBindings(body: Statement[]): Binding[] {
    const bindings: Binding[] = [];
    for (const declaration of hoistedVarDeclarations(body)) {
      bindings.push(...this.collectDeclarationBindings(declaration));
    }
    for (const statement of body) {
      if (statement.type === "ImportDeclaration") {
        bindings.push(...this.collectImportBindings(statement));
        continue;
      }
      if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
        bindings.push({ kind: "let", name: statement.id.name });
        continue;
      }
      if (statement.type === "VariableDeclaration" && statement.kind !== "var") {
        bindings.push(...this.collectDeclarationBindings(statement));
        continue;
      }
      if (statement.type === "ExportNamedDeclaration") {
        bindings.push(...this.collectDeclarationBindings(statement.declaration));
      }
    }
    return bindings;
  }

  private collectBlockBindings(body: Statement[]): Binding[] {
    const bindings: Binding[] = [];
    for (const statement of body) {
      if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
        bindings.push({ kind: "let", name: statement.id.name });
      }
      if (statement.type === "VariableDeclaration" && statement.kind !== "var") {
        bindings.push(...this.collectDeclarationBindings(statement));
      }
    }
    return bindings;
  }

  private collectParameterBindings(node: FunctionNode): Binding[] {
    const bindings: Binding[] = [];
    if (node.type !== "ArrowFunctionExpression") {
      bindings.push({ kind: "let", name: "arguments" });
      if (node.type === "FunctionExpression" && node.id !== undefined) {
        bindings.push({ kind: "const", name: node.id.name });
      }
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

  private collectCatchBindings(node: CatchClause): Binding[] {
    const bindings: Binding[] = [];
    if (node.param !== undefined) {
      this.collectBindingNamesFromPattern(node.param, "let", bindings);
    }
    return bindings;
  }

  private collectImportBindings(node: ImportDeclaration): Binding[] {
    const bindings: Binding[] = [];
    for (const specifier of node.specifiers) {
      bindings.push({ kind: "import", name: specifier.local.name });
    }
    return bindings;
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
        bindings.push({ kind, name: node.name });
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
}

function formatNearMatchMessage(names: string[]): string {
  if (names.length === 1) {
    return `Did you mean '${names[0]}'?`;
  }

  return `Did you mean one of: ${names.map((name) => `'${name}'`).join(", ")}?`;
}

function formatVisibleNamesMessage(names: string[]): string {
  if (names.length === 0) {
    return "No names are in scope.";
  }

  return `In-scope names: ${names.join(", ")}.`;
}

function getLevenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + substitutionCost
      );
    }

    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column]!;
    }
  }

  return previous[right.length]!;
}
