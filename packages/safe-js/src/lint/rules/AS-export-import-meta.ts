import {
  parseModule,
  type ArrayExpression,
  type AssignmentExpression,
  type AssignmentPattern,
  type BinaryExpression,
  type CallExpression,
  type ConditionalExpression,
  type DoWhileStatement,
  type Expression,
  type ForInStatement,
  type ForOfStatement,
  type ForStatement,
  type FunctionExpression,
  type IfStatement,
  type LogicalExpression,
  type MemberExpression,
  type Module,
  type ObjectExpression,
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

type DiagnosticCode =
  | "AS-EXPORT-DEFAULT-MISSING"
  | "AS-EXPORT-DEFAULT-MULTIPLE"
  | "AS-EXPORT-DEFAULT-NOT-ARROW"
  | "AS-EXPORT-DEFAULT-SIGNATURE"
  | "AS-EXPORT-UNKNOWN"
  | "AS-IMPORT-META-ASSIGN"
  | "AS-RETURN-AT-TOP";

export type Diagnostic = {
  code: DiagnosticCode;
  severity: "error" | "warning";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

export type DefaultExportSignature = {
  parameters?: readonly string[];
  required?: boolean;
};

export function AS_EXPORT_IMPORT_META(
  source: string,
  options: {
    allowedExportNames?: readonly string[];
    defaultExport?: DefaultExportSignature;
    filename?: string;
  } = {}
): Diagnostic[] {
  return new Scanner(
    options.filename ?? "<input>",
    new Set(options.allowedExportNames ?? []),
    options.defaultExport
  ).scan(source);
}

class Scanner {
  private readonly diagnostics: Diagnostic[] = [];

  constructor(
    private readonly filename: string,
    private readonly allowedExportNames: ReadonlySet<string>,
    private readonly defaultExport: DefaultExportSignature | undefined
  ) {}

  scan(source: string): Diagnostic[] {
    this.visitModule(parseModule(source, this.filename));
    return this.diagnostics;
  }

  private visitModule(node: Module): void {
    const defaultExports = node.body.filter(
      (statement) => statement.type === "ExportDefaultDeclaration"
    );
    const hasDefaultExport = defaultExports.length > 0;

    if (!hasDefaultExport && this.defaultExport?.required === true) {
      this.pushDiagnostic(
        "AS-EXPORT-DEFAULT-MISSING",
        "error",
        "Module must export a default entry point.",
        node.span
      );
    }

    for (const [index, statement] of defaultExports.entries()) {
      if (index > 0) {
        this.pushDiagnostic(
          "AS-EXPORT-DEFAULT-MULTIPLE",
          "error",
          "Module contains more than one export default declaration.",
          statement.span
        );
      }
    }

    for (const statement of node.body) {
      if (hasDefaultExport && statement.type === "ReturnStatement") {
        this.pushDiagnostic(
          "AS-RETURN-AT-TOP",
          "warning",
          "Top-level return statement is present alongside an export default declaration.",
          statement.span
        );
      }

      this.visitStatement(statement);
    }
  }

  private visitStatement(node: Statement): void {
    switch (node.type) {
      case "FunctionDeclaration":
        for (const param of node.params) {
          this.visitAssignmentTarget(param);
        }
        this.visitStatement(node.body);
        return;
      case "ExportNamedDeclaration":
        this.visitExportNamedDeclaration(node.declaration);
        return;
      case "ExportDefaultDeclaration":
        if (!isDefaultExportCallable(node.declaration)) {
          this.pushDiagnostic(
            "AS-EXPORT-DEFAULT-NOT-ARROW",
            "error",
            "Export default initializer must be an arrow or function expression.",
            node.declaration.span
          );
        } else {
          this.visitDefaultExportSignature(node.declaration);
        }
        this.visitExpression(node.declaration);
        return;
      case "BlockStatement":
        for (const statement of node.body) {
          this.visitStatement(statement);
        }
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
      case "ImportDeclaration":
      case "BreakStatement":
      case "ContinueStatement":
        return;
    }
  }

  private visitExportNamedDeclaration(node: VariableDeclaration): void {
    const declarator = node.declarations[0];
    if (declarator?.id.type === "Identifier" && !this.allowedExportNames.has(declarator.id.name)) {
      this.pushDiagnostic(
        "AS-EXPORT-UNKNOWN",
        "error",
        `Named export '${declarator.id.name}' is not allowed.`,
        declarator.id.span
      );
    }

    this.visitVariableDeclaration(node);
  }

  private visitDefaultExportSignature(
    node: Extract<Expression, { type: "ArrowFunctionExpression" }> | FunctionExpression
  ): void {
    const parameters = this.defaultExport?.parameters;
    if (parameters === undefined) {
      return;
    }

    if (!hasParameterNames(node, parameters)) {
      this.pushDiagnostic(
        "AS-EXPORT-DEFAULT-SIGNATURE",
        "error",
        `Default export must declare signature (${parameters.join(", ")}).`,
        node.span
      );
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
      if (isImportMetaAssignmentTarget(node.left)) {
        this.pushDiagnostic(
          "AS-IMPORT-META-ASSIGN",
          "error",
          "Assignment target must not involve import.meta.",
          node.left.span
        );
      }
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
      this.visitStatement(node.handler.body);
    }
    if (node.finalizer !== undefined) {
      this.visitStatement(node.finalizer);
    }
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
      case "ArrowFunctionExpression":
        for (const param of node.params) {
          this.visitAssignmentTarget(param);
        }
        if (node.body.type === "BlockStatement") {
          this.visitStatement(node.body);
        } else {
          this.visitExpression(node.body);
        }
        return;
      case "FunctionExpression":
        for (const param of node.params) {
          this.visitAssignmentTarget(param);
        }
        this.visitStatement(node.body);
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

  private visitArrayExpression(node: ArrayExpression): void {
    for (const element of node.elements) {
      this.visitExpressionOrSpread(element);
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
    if (isImportMetaAssignmentTarget(node.left)) {
      this.pushDiagnostic(
        "AS-IMPORT-META-ASSIGN",
        "error",
        "Assignment target must not involve import.meta.",
        node.left.span
      );
    }

    this.visitAssignmentTarget(node.left);
    this.visitExpression(node.right);
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
          } else {
            this.visitAssignmentTarget(property.value);
          }
        }
        return;
      case "Identifier":
      case "MetaProperty":
        return;
    }
  }

  private visitCallExpression(node: CallExpression): void {
    this.visitExpression(node.callee);
    for (const argument of node.arguments) {
      this.visitExpressionOrSpread(argument);
    }
  }

  private visitTemplateLiteral(node: TemplateLiteral): void {
    for (const expression of node.expressions) {
      this.visitExpression(expression);
    }
  }

  private visitExpressionOrSpread(node: Expression | SpreadElement): void {
    if (node.type === "SpreadElement") {
      this.visitExpression(node.argument);
      return;
    }

    this.visitExpression(node);
  }

  private pushDiagnostic(
    code: DiagnosticCode,
    severity: Diagnostic["severity"],
    message: string,
    span: SourceSpan
  ): void {
    this.diagnostics.push({
      code,
      severity,
      message,
      filename: this.filename,
      line: span.start.line,
      column: span.start.column,
      span
    });
  }
}

function isDefaultExportCallable(
  node: Expression
): node is Extract<Expression, { type: "ArrowFunctionExpression" }> | FunctionExpression {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

function hasParameterNames(
  node: Extract<Expression, { type: "ArrowFunctionExpression" }> | FunctionExpression,
  names: readonly string[]
): boolean {
  if (node.params.length !== names.length) {
    return false;
  }

  return node.params.every(
    (param, index) => param.type === "Identifier" && param.name === names[index]
  );
}

function isImportMetaReference(node: AssignmentExpression["left"] | Expression): boolean {
  if (node.type === "MetaProperty") {
    return true;
  }

  return (
    node.type === "MemberExpression" &&
    (isImportMetaReference(node.object) || (node.computed && isImportMetaReference(node.property)))
  );
}

function isImportMetaAssignmentTarget(
  node: AssignmentExpression["left"] | AssignmentPattern | RestElement
): boolean {
  switch (node.type) {
    case "MetaProperty":
      return true;
    case "MemberExpression":
      return isImportMetaReference(node);
    case "AssignmentPattern":
      return isImportMetaAssignmentTarget(node.left);
    case "RestElement":
      return isImportMetaAssignmentTarget(node.argument);
    case "ArrayPattern":
      return node.elements.some(
        (element) => element !== null && isImportMetaAssignmentTarget(element)
      );
    case "ObjectPattern":
      return node.properties.some((property) =>
        isImportMetaAssignmentTarget(property.type === "RestElement" ? property : property.value)
      );
    case "Identifier":
      return false;
  }
}
