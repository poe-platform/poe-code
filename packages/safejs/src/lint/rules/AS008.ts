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
  code: "AS008";
  severity: "error";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

const MESSAGE = "Await is only allowed at the script top level or inside async arrow functions.";

export function AS008(source: string, options: { filename?: string } = {}): Diagnostic[] {
  return new AS008Scanner(options.filename ?? "<input>").scan(source);
}

class AS008Scanner {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly functionStack: boolean[] = [];
  private scopeDepth = 0;

  constructor(private readonly filename: string) {}

  scan(source: string): Diagnostic[] {
    const module = parseModule(source, this.filename);
    this.visitModule(module);
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
        this.visitArrowFunction(node);
        return;
      case "BlockStatement":
        this.withNestedScope(() => {
          this.visitBlock(node);
        });
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

  private visitBlock(node: BlockStatement): void {
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
    this.visitStatement(node.block);
    if (node.handler !== undefined) {
      this.visitCatchClause(node.handler);
    }
    if (node.finalizer !== undefined) {
      this.visitStatement(node.finalizer);
    }
  }

  private visitCatchClause(node: CatchClause): void {
    this.withNestedScope(() => {
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

  private visitExpression(node: Expression): void {
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
    this.functionStack.push(node.async);
    for (const parameter of node.params) {
      this.visitBindingElement(parameter);
    }
    const body = node.body;
    if (body.type === "BlockStatement") {
      this.withNestedScope(() => {
        this.visitBlock(body);
      });
    } else {
      this.visitExpression(body);
    }
    this.functionStack.pop();
  }

  private visitAwaitExpression(node: AwaitExpression): void {
    if (!this.isAwaitAllowed()) {
      this.diagnostics.push({
        code: "AS008",
        severity: "error",
        message: MESSAGE,
        filename: this.filename,
        line: node.span.start.line,
        column: node.span.start.column,
        span: node.span
      });
    }

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

  private visitAssignmentTarget(node: AssignmentExpression["left"]): void {
    if (node.type === "Identifier") {
      return;
    }
    if (node.type === "MetaProperty") {
      return;
    }
    if (node.type === "MemberExpression") {
      this.visitMemberExpression(node);
      return;
    }
    this.visitBindingPattern(node);
  }

  private visitBindingElement(
    node: AssignmentPattern | ArrayPattern | Identifier | ObjectPattern | RestElement
  ): void {
    if (node.type === "RestElement") {
      this.visitRestElement(node);
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
      if (element === null) {
        continue;
      }
      if (element.type === "RestElement") {
        this.visitRestElement(element);
        continue;
      }
      this.visitBindingPattern(element);
    }
  }

  private visitObjectPattern(node: ObjectPattern): void {
    for (const property of node.properties) {
      if (property.type === "RestElement") {
        this.visitRestElement(property);
        continue;
      }
      this.visitAssignmentProperty(property);
    }
  }

  private visitAssignmentProperty(node: AssignmentProperty): void {
    if (node.computed) {
      this.visitExpression(node.key);
    }
    this.visitBindingPattern(node.value);
  }

  private visitRestElement(node: RestElement): void {
    this.visitAssignmentTarget(node.argument);
  }

  private isAwaitAllowed(): boolean {
    const currentFunction = this.functionStack.at(-1);
    if (currentFunction !== undefined) {
      return true;
    }

    return this.scopeDepth === 0;
  }

  private withNestedScope(callback: () => void): void {
    this.scopeDepth += 1;
    try {
      callback();
    } finally {
      this.scopeDepth -= 1;
    }
  }
}
