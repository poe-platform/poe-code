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
  code: "AS-NEEDLESS-TEMPLATE";
  severity: "info";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
  fix: {
    range: readonly [number, number];
    replacement: string;
  };
  hint: string;
};

export const AS_NEEDLESS_TEMPLATE_MESSAGE =
  "Template literals with only one interpolation should use the value or String(value).";

export function AS_NEEDLESS_TEMPLATE(
  source: string,
  options: { filename?: string } = {}
): Diagnostic[] {
  return new ASNeedlessTemplateScanner(source, options.filename ?? "<input>").scan();
}

export function fixASNeedlessTemplate(source: string, options: { filename?: string } = {}): string {
  const filename = options.filename ?? "<input>";
  let result = source;

  while (true) {
    const diagnostics = new ASNeedlessTemplateScanner(result, filename).collect();
    if (diagnostics.length === 0) {
      return result;
    }

    const next = selectInnermostDiagnostics(diagnostics)
      .sort((left, right) => right.span.start.offset - left.span.start.offset)
      .reduce((current, diagnostic) => {
        return `${current.slice(0, diagnostic.span.start.offset)}${createReplacement(current, diagnostic)}${current.slice(diagnostic.span.end.offset)}`;
      }, result);

    if (next === result) {
      return result;
    }

    result = next;
  }
}

type InternalDiagnostic = Diagnostic & {
  expression: Expression;
  expressionSpan: SourceSpan;
};

class ASNeedlessTemplateScanner {
  private readonly diagnostics: InternalDiagnostic[] = [];

  constructor(
    private readonly source: string,
    private readonly filename: string
  ) {}

  scan(): Diagnostic[] {
    this.visitModule(parseModule(this.source, this.filename));
    return this.diagnostics.map(
      ({ expression: _expression, expressionSpan: _expressionSpan, ...diagnostic }) => diagnostic
    );
  }

  collect(): InternalDiagnostic[] {
    this.visitModule(parseModule(this.source, this.filename));
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
        this.visitTemplateLiteral(node, true);
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
    for (const param of node.params) {
      this.visitBindingElement(param);
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

  private visitTemplateLiteral(node: TemplateLiteral, canReport: boolean): void {
    if (canReport && isNeedlessTemplate(node)) {
      this.report(node, node.expressions[0]);
    }

    for (const expression of node.expressions) {
      this.visitExpression(expression);
    }
  }

  private visitTaggedTemplateExpression(node: TaggedTemplateExpression): void {
    this.visitExpression(node.tag);
    this.visitTemplateLiteral(node.quasi, false);
  }

  private visitAssignmentTarget(node: AssignmentExpression["left"]): void {
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

  private visitBindingElement(
    node:
      | AssignmentPattern
      | ArrayPattern
      | MemberExpression
      | ObjectPattern
      | PatternTarget
      | RestElement
  ): void {
    if (node.type === "RestElement") {
      this.visitAssignmentTarget(node.argument);
      return;
    }

    this.visitBindingPattern(node);
  }

  private visitBindingPattern(
    node: AssignmentPattern | ArrayPattern | MemberExpression | ObjectPattern | PatternTarget
  ): void {
    switch (node.type) {
      case "Identifier":
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
        return;
      case "AssignmentPattern":
        this.visitBindingPattern(node.left);
        this.visitExpression(node.right);
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
            this.visitAssignmentTarget(property.argument);
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
    this.visitBindingPattern(node.value);
  }

  private report(template: TemplateLiteral, expression: Expression): void {
    this.diagnostics.push({
      code: "AS-NEEDLESS-TEMPLATE",
      severity: "info",
      message: AS_NEEDLESS_TEMPLATE_MESSAGE,
      hint: `Use ${createStringReplacement(
        this.source.slice(expression.span.start.offset, expression.span.end.offset),
        expression
      )}.`,
      filename: this.filename,
      line: template.span.start.line,
      column: template.span.start.column,
      span: template.span,
      fix: {
        range: [template.span.start.offset, template.span.end.offset],
        replacement: createStringReplacement(
          this.source.slice(expression.span.start.offset, expression.span.end.offset),
          expression
        )
      },
      expression,
      expressionSpan: expression.span
    });
  }
}

function selectInnermostDiagnostics(
  diagnostics: readonly InternalDiagnostic[]
): InternalDiagnostic[] {
  return diagnostics.filter(
    (candidate) =>
      !diagnostics.some((other) => other !== candidate && containsSpan(candidate.span, other.span))
  );
}

function containsSpan(outer: SourceSpan, inner: SourceSpan): boolean {
  return outer.start.offset <= inner.start.offset && inner.end.offset <= outer.end.offset;
}

function createReplacement(source: string, diagnostic: InternalDiagnostic): string {
  return createStringReplacement(
    source.slice(diagnostic.expressionSpan.start.offset, diagnostic.expressionSpan.end.offset),
    diagnostic.expression
  );
}

function createStringReplacement(expressionSource: string, expression: Expression): string {
  if (isStringCallExpression(expression)) {
    return expressionSource;
  }

  return `String(${expressionSource})`;
}

function isStringCallExpression(expression: Expression): boolean {
  return (
    expression.type === "CallExpression" &&
    expression.callee.type === "Identifier" &&
    expression.callee.name === "String"
  );
}

function isNeedlessTemplate(node: TemplateLiteral): boolean {
  if (node.expressions.length !== 1 || node.quasis.length !== 2) {
    return false;
  }

  return (
    node.expressions[0]?.type !== "TemplateLiteral" &&
    node.quasis.every((quasi) => quasi.value.raw === "")
  );
}
