import { visitClassElements } from "../class-elements.js";
import {
  parseModule,
  type ArrayExpression,
  type FunctionNode,
  type AssignmentExpression,
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
  type LogicalExpression,
  type MemberExpression,
  type Module,
  type ObjectExpression,
  type Property,
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
import { hasTypedModuleRegistrations, type Modules } from "./module-registry.js";

type PrimitiveType = "boolean" | "null" | "number" | "string" | "undefined";

type SupportedType =
  | {
      kind: "array";
      element: PrimitiveType;
    }
  | {
      kind: "object";
      fields: ReadonlyMap<string, PrimitiveType>;
    }
  | {
      kind: "primitive";
      name: PrimitiveType;
    };

type ParsedType =
  | {
      status: "invalid";
    }
  | {
      status: "supported";
      type: SupportedType;
    }
  | {
      status: "unsupported";
    };

type ParsedObjectFields =
  | {
      fields: ReadonlyMap<string, PrimitiveType>;
      status: "supported";
    }
  | {
      status: "invalid" | "unsupported";
    };

type JsdocTypeTag = {
  kind: "type";
  raw: string;
  span: SourceSpan;
  type?: SupportedType;
};

type JsdocParamTag = {
  kind: "param";
  name: string;
  raw: string;
  span: SourceSpan;
  type?: SupportedType;
};

type ParsedJsdoc = {
  params: JsdocParamTag[];
  type?: JsdocTypeTag;
};

type JsdocBlock = {
  endOffset: number;
  startOffset: number;
};

export type Diagnostic = {
  code: "AS-JSDOC-TYPE";
  severity: "warning";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: SourceSpan;
};

export function AS_JSDOC_TYPE(
  source: string,
  options: { filename?: string; modules?: Modules } = {}
): Diagnostic[] {
  if (!hasTypedModuleRegistrations(options.modules)) {
    return [];
  }

  return new ASJsdocTypeScanner(source, options.filename ?? "<input>").scan();
}

class ASJsdocTypeScanner {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly jsdocBlocks: JsdocBlock[];
  private readonly parsedJsdoc = new Map<number, ParsedJsdoc>();

  constructor(
    private readonly source: string,
    private readonly filename: string
  ) {
    this.jsdocBlocks = collectJsdocBlocks(source);
  }

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
        if (node.expression.type === "AssignmentExpression") {
          this.validateAssignmentExpression(
            node.expression,
            this.findLeadingJsdoc(node.span.start.offset)
          );
        }
        this.visitExpression(node.expression);
        return;
      case "IfStatement":
        this.visitExpression(node.test);
        this.visitStatement(node.consequent);
        if (node.alternate !== undefined) {
          this.visitStatement(node.alternate);
        }
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
        this.visitVariableDeclaration(node, this.findLeadingJsdoc(node.span.start.offset));
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
        this.visitVariableDeclaration(
          node.declaration,
          this.findLeadingJsdoc(node.span.start.offset)
        );
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

  private visitBlockStatement(node: BlockStatement): void {
    for (const statement of node.body) {
      this.visitStatement(statement);
    }
  }

  private visitForStatement(node: ForStatement): void {
    if (node.init !== undefined) {
      if (node.init.type === "VariableDeclaration") {
        this.visitVariableDeclaration(
          node.init,
          this.findLeadingJsdoc(node.init.span.start.offset)
        );
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
      this.visitVariableDeclaration(node.left, this.findLeadingJsdoc(node.left.span.start.offset));
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
    this.visitBlockStatement(node.body);
  }

  private visitThrowStatement(node: ThrowStatement): void {
    this.visitExpression(node.argument);
  }

  private visitVariableDeclaration(
    node: VariableDeclaration,
    jsdoc: ParsedJsdoc | undefined
  ): void {
    for (const declarator of node.declarations) {
      this.visitVariableDeclarator(declarator, jsdoc);
    }
  }

  private visitVariableDeclarator(node: VariableDeclarator, jsdoc: ParsedJsdoc | undefined): void {
    if (node.init !== undefined && jsdoc?.type?.type !== undefined) {
      this.validateExpression(jsdoc.type.type, jsdoc.type.raw, node.init);
    }

    if (node.init?.type === "ArrowFunctionExpression" && jsdoc !== undefined) {
      this.validateArrowParams(node.init, jsdoc);
    }

    if (node.init !== undefined) {
      this.visitExpression(node.init);
    }
  }

  private validateAssignmentExpression(
    node: AssignmentExpression,
    jsdoc: ParsedJsdoc | undefined
  ): void {
    if (node.operator === "=" && jsdoc?.type?.type !== undefined) {
      this.validateExpression(jsdoc.type.type, jsdoc.type.raw, node.right);
    }
  }

  private validateArrowParams(node: FunctionNode, jsdoc: ParsedJsdoc): void {
    const typedParams = new Map(
      jsdoc.params.filter((param) => param.type !== undefined).map((param) => [param.name, param])
    );

    for (const param of node.params) {
      if (param.type !== "AssignmentPattern" || param.left.type !== "Identifier") {
        continue;
      }

      const tag = typedParams.get(param.left.name);
      if (tag?.type !== undefined) {
        this.validateExpression(tag.type, tag.raw, param.right);
      }
    }
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
      case "AssignmentExpression":
        this.visitExpression(node.right);
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
      case "CallExpression":
        this.visitCallExpression(node);
        return;
      case "MemberExpression":
        this.visitMemberExpression(node);
        return;
      case "TaggedTemplateExpression":
        this.visitTaggedTemplateExpression(node);
        return;
      case "TemplateLiteral":
        this.visitTemplateLiteral(node);
        return;
      case "AwaitExpression":
        this.visitExpression(node.argument);
        return;
      case "BooleanLiteral":
      case "Identifier":
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
      if (param.type === "AssignmentPattern") {
        this.visitExpression(param.right);
      }
    }

    if (node.body.type === "BlockStatement") {
      this.visitBlockStatement(node.body);
    } else {
      this.visitExpression(node.body);
    }
  }

  private visitArrayExpression(node: ArrayExpression): void {
    for (const element of node.elements) {
      this.visitExpression(element.type === "SpreadElement" ? element.argument : element);
    }
  }

  private visitObjectExpression(node: ObjectExpression): void {
    for (const property of node.properties) {
      if (property.type === "SpreadElement") {
        this.visitExpression(property.argument);
      } else {
        this.visitExpression(property.value);
      }
    }
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

  private visitCallExpression(node: CallExpression): void {
    this.visitExpression(node.callee);
    for (const argument of node.arguments) {
      this.visitExpression(argument.type === "SpreadElement" ? argument.argument : argument);
    }
  }

  private visitMemberExpression(node: MemberExpression): void {
    this.visitExpression(node.object);
    if (node.computed) {
      this.visitExpression(node.property);
    }
  }

  private visitTaggedTemplateExpression(node: TaggedTemplateExpression): void {
    this.visitExpression(node.tag);
    this.visitTemplateLiteral(node.quasi);
  }

  private visitTemplateLiteral(node: TemplateLiteral): void {
    for (const expression of node.expressions) {
      this.visitExpression(expression);
    }
  }

  private validateExpression(
    expected: SupportedType,
    declaredType: string,
    expression: Expression
  ): void {
    switch (expected.kind) {
      case "primitive":
        this.validatePrimitiveExpression(expected.name, declaredType, expression);
        return;
      case "array":
        this.validateArrayExpression(expected.element, declaredType, expression);
        return;
      case "object":
        this.validateObjectExpression(expected.fields, declaredType, expression);
        return;
    }
  }

  private validatePrimitiveExpression(
    expected: PrimitiveType,
    declaredType: string,
    expression: Expression
  ): void {
    const actual = inferExpressionKind(expression);
    if (actual !== undefined && actual !== expected) {
      this.pushMismatch(declaredType, actual, expression.span, "value");
    }
  }

  private validateArrayExpression(
    expected: PrimitiveType,
    declaredType: string,
    expression: Expression
  ): void {
    if (expression.type !== "ArrayExpression") {
      const actual = inferExpressionKind(expression);
      if (actual !== undefined) {
        this.pushMismatch(declaredType, actual, expression.span, "value");
      }
      return;
    }

    for (const element of expression.elements) {
      if (element.type === "SpreadElement") {
        continue;
      }

      const actual = inferExpressionKind(element);
      if (actual !== undefined && actual !== expected) {
        this.pushMismatch(declaredType, actual, element.span, "array element");
      }
    }
  }

  private validateObjectExpression(
    expectedFields: ReadonlyMap<string, PrimitiveType>,
    declaredType: string,
    expression: Expression
  ): void {
    if (expression.type !== "ObjectExpression") {
      const actual = inferExpressionKind(expression);
      if (actual !== undefined) {
        this.pushMismatch(declaredType, actual, expression.span, "value");
      }
      return;
    }

    for (const property of expression.properties) {
      if (property.type === "SpreadElement") {
        continue;
      }

      const fieldName = getPropertyName(property);
      const expected = fieldName === undefined ? undefined : expectedFields.get(fieldName);
      const actual = inferExpressionKind(property.value);
      if (expected !== undefined && actual !== undefined && actual !== expected) {
        this.pushMismatch(
          declaredType,
          actual,
          property.value.span,
          `value for property '${fieldName}'`
        );
      }
    }
  }

  private findLeadingJsdoc(nodeStartOffset: number): ParsedJsdoc | undefined {
    for (let index = this.jsdocBlocks.length - 1; index >= 0; index -= 1) {
      const block = this.jsdocBlocks[index];
      if (block.endOffset > nodeStartOffset) {
        continue;
      }

      if (this.source.slice(block.endOffset, nodeStartOffset).trim().length > 0) {
        return undefined;
      }

      return this.parseJsdocBlock(block);
    }

    return undefined;
  }

  private parseJsdocBlock(block: JsdocBlock): ParsedJsdoc {
    const cached = this.parsedJsdoc.get(block.startOffset);
    if (cached !== undefined) {
      return cached;
    }

    const parsed = parseJsdocBlock(this.source, block, (tagName, raw, span) => {
      this.diagnostics.push({
        code: "AS-JSDOC-TYPE",
        severity: "warning",
        message: `Could not parse JSDoc @${tagName} annotation '${raw}'.`,
        filename: this.filename,
        line: span.start.line,
        column: span.start.column,
        span
      });
    });

    this.parsedJsdoc.set(block.startOffset, parsed);
    return parsed;
  }

  private pushMismatch(
    declaredType: string,
    actualType: string,
    span: SourceSpan,
    target: string
  ): void {
    this.diagnostics.push({
      code: "AS-JSDOC-TYPE",
      severity: "warning",
      message: `JSDoc type '${declaredType}' does not match ${actualType} ${target}.`,
      filename: this.filename,
      line: span.start.line,
      column: span.start.column,
      span
    });
  }
}

function collectJsdocBlocks(source: string): JsdocBlock[] {
  const blocks: JsdocBlock[] = [];
  let index = 0;

  while (index < source.length) {
    if (source[index] !== "/" || source[index + 1] !== "*" || source[index + 2] !== "*") {
      index += 1;
      continue;
    }

    const startOffset = index;
    index += 3;
    while (index < source.length && (source[index] !== "*" || source[index + 1] !== "/")) {
      index += 1;
    }

    if (index >= source.length) {
      break;
    }

    blocks.push({
      startOffset,
      endOffset: index + 2
    });
    index += 2;
  }

  return blocks;
}

function parseJsdocBlock(
  source: string,
  block: JsdocBlock,
  onParseError: (tagName: "param" | "type", raw: string, span: SourceSpan) => void
): ParsedJsdoc {
  const parsed: ParsedJsdoc = {
    params: []
  };
  let index = block.startOffset + 3;
  const end = block.endOffset - 2;

  while (index < end) {
    if (source[index] !== "@") {
      index += 1;
      continue;
    }

    const tagStart = index;
    index += 1;
    const tagNameStart = index;
    while (index < end && isIdentifierPart(source[index])) {
      index += 1;
    }

    const tagName = source.slice(tagNameStart, index);
    if (tagName !== "param" && tagName !== "type") {
      index = skipToNextTag(source, index, end);
      continue;
    }

    index = skipWhitespace(source, index, end);
    const annotation = readBracedAnnotation(source, index, end);
    if (annotation === undefined) {
      onParseError(tagName, "", createSpanFromOffsets(source, tagStart, index));
      index = skipToNextTag(source, index, end);
      continue;
    }

    const trimmed = trimAnnotation(source, annotation.contentStart, annotation.contentEnd);
    const type = parseSupportedType(source.slice(trimmed.startOffset, trimmed.endOffset));
    if (type.status === "invalid") {
      onParseError(
        tagName,
        source.slice(trimmed.startOffset, trimmed.endOffset),
        createSpanFromOffsets(source, trimmed.startOffset, trimmed.endOffset)
      );
      index = annotation.endOffset;
      continue;
    }

    index = annotation.endOffset;
    if (tagName === "type") {
      parsed.type = {
        kind: "type",
        raw: source.slice(trimmed.startOffset, trimmed.endOffset),
        span: createSpanFromOffsets(source, trimmed.startOffset, trimmed.endOffset),
        type: type.status === "supported" ? type.type : undefined
      };
      continue;
    }

    index = skipWhitespace(source, index, end);
    const paramNameStart = index;
    while (index < end && isIdentifierPart(source[index])) {
      index += 1;
    }
    const paramName = source.slice(paramNameStart, index);
    if (paramName.length === 0) {
      onParseError(
        "param",
        source.slice(trimmed.startOffset, trimmed.endOffset),
        createSpanFromOffsets(source, trimmed.startOffset, trimmed.endOffset)
      );
      continue;
    }

    parsed.params.push({
      kind: "param",
      name: paramName,
      raw: source.slice(trimmed.startOffset, trimmed.endOffset),
      span: createSpanFromOffsets(source, trimmed.startOffset, trimmed.endOffset),
      type: type.status === "supported" ? type.type : undefined
    });
  }

  return parsed;
}

function readBracedAnnotation(
  source: string,
  startOffset: number,
  endOffset: number
): { contentEnd: number; contentStart: number; endOffset: number } | undefined {
  if (source[startOffset] !== "{") {
    return undefined;
  }

  let depth = 0;
  for (let index = startOffset; index < endOffset; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          contentStart: startOffset + 1,
          contentEnd: index,
          endOffset: index + 1
        };
      }
    }
  }

  return undefined;
}

function parseSupportedType(source: string): ParsedType {
  if (isPrimitiveType(source)) {
    return {
      status: "supported",
      type: {
        kind: "primitive",
        name: source
      }
    };
  }

  if (source.endsWith("[]")) {
    const element = source.slice(0, -2);
    return isPrimitiveType(element)
      ? {
          status: "supported",
          type: {
            kind: "array",
            element
          }
        }
      : { status: "unsupported" };
  }

  if (source.startsWith("{") && source.endsWith("}")) {
    const fields = parseObjectFields(source.slice(1, -1));
    return fields.status !== "supported"
      ? { status: fields.status }
      : {
          status: "supported",
          type: {
            kind: "object",
            fields: fields.fields
          }
        };
  }

  if (source.includes("<") || source.includes(">") || source.includes("|")) {
    return { status: "unsupported" };
  }

  return source.includes(" ") ? { status: "invalid" } : { status: "unsupported" };
}

function parseObjectFields(source: string): ParsedObjectFields {
  const fields = new Map<string, PrimitiveType>();
  let index = 0;

  while (index < source.length) {
    index = skipWhitespace(source, index, source.length);
    if (index >= source.length) {
      return {
        fields,
        status: "supported"
      };
    }

    const nameStart = index;
    if (!isIdentifierStart(source[index])) {
      return { status: "invalid" };
    }

    index += 1;
    while (index < source.length && isIdentifierPart(source[index])) {
      index += 1;
    }

    const fieldName = source.slice(nameStart, index);
    index = skipWhitespace(source, index, source.length);
    if (source[index] === "?") {
      index += 1;
      index = skipWhitespace(source, index, source.length);
    }
    if (source[index] !== ":") {
      return { status: "invalid" };
    }

    index += 1;
    index = skipWhitespace(source, index, source.length);
    const typeStart = index;
    while (index < source.length && source[index] !== "," && source[index] !== ";") {
      index += 1;
    }

    const trimmed = trimAnnotation(source, typeStart, index);
    const fieldType = source.slice(trimmed.startOffset, trimmed.endOffset);
    if (!isPrimitiveType(fieldType)) {
      return classifyObjectFieldType(fieldType);
    }

    fields.set(fieldName, fieldType);
    index = skipWhitespace(source, index, source.length);
    if (index >= source.length) {
      return {
        fields,
        status: "supported"
      };
    }
    if (source[index] !== "," && source[index] !== ";") {
      return { status: "invalid" };
    }
    index += 1;
  }

  return {
    fields,
    status: "supported"
  };
}

function classifyObjectFieldType(source: string): ParsedObjectFields {
  if (source.length === 0) {
    return { status: "invalid" };
  }

  for (const char of source) {
    if (
      char === "<" ||
      char === ">" ||
      char === "[" ||
      char === "]" ||
      char === "{" ||
      char === "}" ||
      char === "|" ||
      char === "&" ||
      char === "(" ||
      char === ")" ||
      char === "?"
    ) {
      return { status: "unsupported" };
    }
  }

  return source.includes(" ") || source.includes(":")
    ? { status: "invalid" }
    : { status: "unsupported" };
}

function inferExpressionKind(
  expression: Expression
): PrimitiveType | "array" | "object" | undefined {
  switch (expression.type) {
    case "ArrayExpression":
      return "array";
    case "BooleanLiteral":
      return "boolean";
    case "NullLiteral":
      return "null";
    case "NumericLiteral":
      return "number";
    case "ObjectExpression":
      return "object";
    case "StringLiteral":
      return "string";
    case "TemplateLiteral":
      return expression.expressions.length === 0 ? "string" : undefined;
    case "UndefinedLiteral":
      return "undefined";
    case "UnaryExpression":
      if (
        (expression.operator === "-" || expression.operator === "+") &&
        expression.argument.type === "NumericLiteral"
      ) {
        return "number";
      }
      if (expression.operator === "!") {
        return "boolean";
      }
      return undefined;
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "AssignmentExpression":
    case "AwaitExpression":
    case "BinaryExpression":
    case "CallExpression":
    case "ConditionalExpression":
    case "Identifier":
    case "LogicalExpression":
    case "MemberExpression":
    case "MetaProperty":
    case "RegexLiteral":
    case "TaggedTemplateExpression":
      return undefined;
  }
}

function getPropertyName(property: Property): string | undefined {
  if (property.computed) {
    return undefined;
  }

  if (property.key.type === "Identifier") {
    return property.key.name;
  }

  if (property.key.type === "StringLiteral") {
    return property.key.value;
  }

  return undefined;
}

function trimAnnotation(
  source: string,
  startOffset: number,
  endOffset: number
): { endOffset: number; startOffset: number } {
  let start = startOffset;
  let end = endOffset;

  while (start < end && isWhitespace(source[start])) {
    start += 1;
  }
  while (end > start && isWhitespace(source[end - 1])) {
    end -= 1;
  }

  return {
    startOffset: start,
    endOffset: end
  };
}

function skipWhitespace(source: string, startOffset: number, endOffset: number): number {
  let index = startOffset;
  while (index < endOffset && isWhitespace(source[index])) {
    index += 1;
  }
  return index;
}

function skipToNextTag(source: string, startOffset: number, endOffset: number): number {
  let index = startOffset;
  while (index < endOffset && source[index] !== "@") {
    index += 1;
  }
  return index;
}

function isPrimitiveType(value: string): value is PrimitiveType {
  return (
    value === "boolean" ||
    value === "null" ||
    value === "number" ||
    value === "string" ||
    value === "undefined"
  );
}

function isIdentifierStart(value: string | undefined): boolean {
  return (
    value !== undefined &&
    ((value >= "A" && value <= "Z") ||
      (value >= "a" && value <= "z") ||
      value === "_" ||
      value === "$")
  );
}

function isIdentifierPart(value: string | undefined): boolean {
  return isIdentifierStart(value) || (value !== undefined && value >= "0" && value <= "9");
}

function isWhitespace(value: string | undefined): boolean {
  return value === " " || value === "\n" || value === "\r" || value === "\t";
}

function createSpanFromOffsets(source: string, startOffset: number, endOffset: number): SourceSpan {
  return {
    start: positionAt(source, startOffset),
    end: positionAt(source, endOffset)
  };
}

function positionAt(source: string, offset: number): SourceSpan["start"] {
  let line = 1;
  let column = 1;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return {
    line,
    column,
    offset
  };
}
