import {
  parseModule,
  type ArrayExpression,
  type ArrayPattern,
  type ArrowFunctionExpression,
  type FunctionExpression,
  type FunctionDeclaration,
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

export type Diagnostic = {
  code: "AS-ASYNC-NOT-NEEDED";
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
};

export const AS_ASYNC_NOT_NEEDED_MESSAGE =
  "Async functions without await should remove the async keyword.";

export function AS_ASYNC_NOT_NEEDED(
  source: string,
  options: { filename?: string } = {}
): Diagnostic[] {
  return new ASAsyncNotNeededScanner(source, options.filename ?? "<input>").scan();
}

export function fixASAsyncNotNeeded(source: string, options: { filename?: string } = {}): string {
  return AS_ASYNC_NOT_NEEDED(source, options)
    .sort((left, right) => right.span.start.offset - left.span.start.offset)
    .reduce((result, diagnostic) => {
      const start = diagnostic.span.start.offset;
      const end =
        source[start + "async".length] === " "
          ? diagnostic.span.end.offset + 1
          : diagnostic.span.end.offset;
      return `${result.slice(0, start)}${result.slice(end)}`;
    }, source);
}

class ASAsyncNotNeededScanner {
  private readonly diagnostics: Diagnostic[] = [];

  constructor(
    private readonly source: string,
    private readonly filename: string
  ) {}

  scan(): Diagnostic[] {
    this.visitModule(parseModule(this.source, this.filename));
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
        this.visitFunctionExpression(node);
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
        if (node.declaration.type === "ArrowFunctionExpression") {
          this.visitArrowFunction(node.declaration, true);
          return;
        }
        if (node.declaration.type === "FunctionExpression") {
          this.visitFunctionExpression(node.declaration, true);
          return;
        }
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
    switch (node.type) {
      case "YieldExpression":
        if (node.argument !== undefined) {
          this.visitExpression(node.argument);
        }
        return;
      case "ArrowFunctionExpression":
        this.visitArrowFunction(node, false);
        return;
      case "FunctionExpression":
        this.visitFunctionExpression(node);
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

  private visitArrowFunction(node: ArrowFunctionExpression, isDefaultExportedArrow: boolean): void {
    if (node.async && !isDefaultExportedArrow && !bodyContainsAwait(node.body)) {
      this.report(createAsyncKeywordSpan(node.span));
    }

    for (const param of node.params) {
      this.visitBindingElement(param);
    }

    if (node.body.type === "BlockStatement") {
      this.visitBlockStatement(node.body);
      return;
    }

    this.visitExpression(node.body);
  }

  private visitFunctionExpression(
    node: FunctionExpression | FunctionDeclaration,
    isDefaultExport = false
  ): void {
    if (node.async && !isDefaultExport && !bodyContainsAwait(node.body)) {
      this.report(createAsyncKeywordSpan(node.span));
    }

    for (const param of node.params) {
      this.visitBindingElement(param);
    }
    this.visitBlockStatement(node.body);
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
      | Identifier
      | MemberExpression
      | ObjectPattern
      | RestElement
  ): void {
    if (node.type === "RestElement") {
      this.visitAssignmentTarget(node.argument);
      return;
    }

    this.visitBindingPattern(node);
  }

  private visitBindingPattern(
    node: AssignmentPattern | ArrayPattern | Identifier | MemberExpression | ObjectPattern
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

  private report(span: SourceSpan): void {
    const end =
      this.source[span.start.offset + "async".length] === " "
        ? span.end.offset + 1
        : span.end.offset;
    this.diagnostics.push({
      code: "AS-ASYNC-NOT-NEEDED",
      severity: "info",
      message: AS_ASYNC_NOT_NEEDED_MESSAGE,
      filename: this.filename,
      line: span.start.line,
      column: span.start.column,
      span,
      fix: {
        range: [span.start.offset, end],
        replacement: ""
      }
    });
  }
}

function createAsyncKeywordSpan(span: SourceSpan): SourceSpan {
  return {
    start: { ...span.start },
    end: {
      line: span.start.line,
      column: span.start.column + "async".length,
      offset: span.start.offset + "async".length
    }
  };
}

function bodyContainsAwait(node: BlockStatement | Expression): boolean {
  return node.type === "BlockStatement"
    ? statementListContainsAwait(node.body)
    : expressionContainsAwait(node);
}

function statementListContainsAwait(statements: readonly Statement[]): boolean {
  return statements.some(statementContainsAwait);
}

function statementContainsAwait(node: Statement): boolean {
  switch (node.type) {
    case "BlockStatement":
      return statementListContainsAwait(node.body);
    case "ExpressionStatement":
      return expressionContainsAwait(node.expression);
    case "IfStatement":
      return (
        expressionContainsAwait(node.test) ||
        statementContainsAwait(node.consequent) ||
        (node.alternate !== undefined && statementContainsAwait(node.alternate))
      );
    case "ForStatement":
      return (
        (node.init?.type === "VariableDeclaration"
          ? variableDeclarationContainsAwait(node.init)
          : node.init !== undefined && expressionContainsAwait(node.init)) ||
        (node.test !== undefined && expressionContainsAwait(node.test)) ||
        (node.update !== undefined && expressionContainsAwait(node.update)) ||
        statementContainsAwait(node.body)
      );
    case "ForInStatement":
    case "ForOfStatement":
      return (
        (node.left.type === "VariableDeclaration" && variableDeclarationContainsAwait(node.left)) ||
        (node.left.type !== "VariableDeclaration" && assignmentTargetContainsAwait(node.left)) ||
        expressionContainsAwait(node.right) ||
        statementContainsAwait(node.body)
      );
    case "WhileStatement":
    case "DoWhileStatement":
      return expressionContainsAwait(node.test) || statementContainsAwait(node.body);
    case "TryStatement":
      return (
        statementListContainsAwait(node.block.body) ||
        (node.handler !== undefined && catchClauseContainsAwait(node.handler)) ||
        (node.finalizer !== undefined && statementListContainsAwait(node.finalizer.body))
      );
    case "SwitchStatement":
      return (
        expressionContainsAwait(node.discriminant) ||
        node.cases.some(
          (switchCase) =>
            (switchCase.test !== undefined && expressionContainsAwait(switchCase.test)) ||
            statementListContainsAwait(switchCase.consequent)
        )
      );
    case "VariableDeclaration":
      return variableDeclarationContainsAwait(node);
    case "ReturnStatement":
      return node.argument !== undefined && expressionContainsAwait(node.argument);
    case "ThrowStatement":
      return expressionContainsAwait(node.argument);
    case "ExportNamedDeclaration":
      return variableDeclarationContainsAwait(node.declaration);
    case "ExportDefaultDeclaration":
      return expressionContainsAwait(node.declaration);
    case "ImportDeclaration":
    case "FunctionDeclaration":
    case "BreakStatement":
    case "ContinueStatement":
    case "EmptyStatement":
      return false;
  }
}

function catchClauseContainsAwait(node: CatchClause): boolean {
  return (
    (node.param !== undefined && bindingPatternContainsAwait(node.param)) ||
    statementListContainsAwait(node.body.body)
  );
}

function variableDeclarationContainsAwait(node: VariableDeclaration): boolean {
  return node.declarations.some((declarator) => {
    return (
      bindingPatternContainsAwait(declarator.id) ||
      (declarator.init !== undefined && expressionContainsAwait(declarator.init))
    );
  });
}

function expressionContainsAwait(node: Expression): boolean {
  switch (node.type) {
    case "AwaitExpression":
      return true;
    case "YieldExpression":
      return node.argument !== undefined && expressionContainsAwait(node.argument);
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return false;
    case "ArrayExpression":
      return node.elements.some((element) => {
        return element.type === "SpreadElement"
          ? expressionContainsAwait(element.argument)
          : expressionContainsAwait(element);
      });
    case "ObjectExpression":
      return objectExpressionContainsAwait(node);
    case "UnaryExpression":
    case "UpdateExpression":
      return expressionContainsAwait(node.argument);
    case "SequenceExpression":
      return node.expressions.some(expressionContainsAwait);
    case "BinaryExpression":
    case "LogicalExpression":
      return expressionContainsAwait(node.left) || expressionContainsAwait(node.right);
    case "ConditionalExpression":
      return (
        expressionContainsAwait(node.test) ||
        expressionContainsAwait(node.consequent) ||
        expressionContainsAwait(node.alternate)
      );
    case "MemberExpression":
      return (
        expressionContainsAwait(node.object) ||
        (node.computed && expressionContainsAwait(node.property))
      );
    case "AssignmentExpression":
      return assignmentTargetContainsAwait(node.left) || expressionContainsAwait(node.right);
    case "CallExpression":
    case "NewExpression":
      return (
        expressionContainsAwait(node.callee) ||
        node.arguments.some((argument) => {
          return argument.type === "SpreadElement"
            ? expressionContainsAwait(argument.argument)
            : expressionContainsAwait(argument);
        })
      );
    case "TemplateLiteral":
      return node.expressions.some(expressionContainsAwait);
    case "TaggedTemplateExpression":
      return expressionContainsAwait(node.tag) || expressionContainsAwait(node.quasi);
    case "Identifier":
    case "BooleanLiteral":
    case "MetaProperty":
    case "NullLiteral":
    case "NumericLiteral":
    case "RegexLiteral":
    case "StringLiteral":
    case "ThisExpression":
    case "UndefinedLiteral":
      return false;
  }
}

function objectExpressionContainsAwait(node: ObjectExpression): boolean {
  return node.properties.some((property) => {
    if (property.type === "SpreadElement") {
      return expressionContainsAwait(property.argument);
    }

    return (
      (property.computed && expressionContainsAwait(property.key)) ||
      expressionContainsAwait(property.value)
    );
  });
}

function assignmentTargetContainsAwait(node: AssignmentExpression["left"]): boolean {
  switch (node.type) {
    case "Identifier":
    case "MetaProperty":
      return false;
    case "MemberExpression":
      return expressionContainsAwait(node);
    case "ArrayPattern":
    case "ObjectPattern":
      return bindingPatternContainsAwait(node);
  }
}

function bindingElementContainsAwait(
  node:
    | AssignmentPattern
    | ArrayPattern
    | Identifier
    | MemberExpression
    | ObjectPattern
    | RestElement
): boolean {
  if (node.type === "RestElement") {
    return patternTargetContainsAwait(node.argument);
  }

  return bindingPatternContainsAwait(node);
}

function bindingPatternContainsAwait(
  node: AssignmentPattern | ArrayPattern | Identifier | MemberExpression | ObjectPattern
): boolean {
  switch (node.type) {
    case "Identifier":
      return false;
    case "MemberExpression":
      return expressionContainsAwait(node);
    case "AssignmentPattern":
      return bindingPatternContainsAwait(node.left) || expressionContainsAwait(node.right);
    case "ArrayPattern":
      return node.elements.some((element) => {
        return element !== null && bindingElementContainsAwait(element);
      });
    case "ObjectPattern":
      return node.properties.some(assignmentPropertyContainsAwait);
  }
}

function assignmentPropertyContainsAwait(node: AssignmentProperty | RestElement): boolean {
  if (node.type === "RestElement") {
    return patternTargetContainsAwait(node.argument);
  }

  return (
    (node.computed && expressionContainsAwait(node.key)) || bindingPatternContainsAwait(node.value)
  );
}

function patternTargetContainsAwait(node: PatternTarget): boolean {
  switch (node.type) {
    case "Identifier":
      return false;
    case "MemberExpression":
      return expressionContainsAwait(node);
    case "ArrayPattern":
    case "ObjectPattern":
      return bindingPatternContainsAwait(node);
  }
}
