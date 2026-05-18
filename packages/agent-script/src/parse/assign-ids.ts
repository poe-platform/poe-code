import type { Module, ParseResult, SourceSpan } from "./parser.js";

type AstNode = {
  nodeId?: number;
  span: SourceSpan;
  type: string;
  [key: string]: unknown;
};

export function assignIds<T extends Module | ParseResult>(root: T): T {
  const visited = new Set<AstNode>();
  const children: AstNode[] = [];
  let nextId = 0;
  const stack: AstNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (visited.has(node)) {
      continue;
    }

    visited.add(node);
    Object.defineProperty(node, "nodeId", {
      value: nextId,
      writable: true,
      configurable: true,
      enumerable: false
    });
    nextId += 1;

    if (node.type === "UnaryExpression") {
      const argument = (node as { argument?: unknown }).argument;
      if (isAstNode(argument)) {
        stack.push(argument);
      }
      continue;
    }

    if (node.type === "ExpressionStatement") {
      const expression = (node as { expression?: unknown }).expression;
      if (isAstNode(expression)) {
        stack.push(expression);
      }
      continue;
    }

    if (node.type === "Module") {
      const body = (node as { body?: unknown }).body;
      if (Array.isArray(body)) {
        for (let index = body.length - 1; index >= 0; index -= 1) {
          const statement = body[index];
          if (isAstNode(statement)) {
            stack.push(statement);
          }
        }
      }
      continue;
    }

    collectChildren(node, children);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]!);
    }
    children.length = 0;
  }

  return root;
}

function collectChildren(node: AstNode, children: AstNode[]): void {
  for (const key in node) {
    if (key === "nodeId" || key === "span" || key === "type") {
      continue;
    }

    collectChild(node[key], children);
  }

  if (children.length <= 1) {
    return;
  }

  children.sort(compareBySourceOrder);
  const seen = new Set<AstNode>();
  let writeIndex = 0;
  for (const child of children) {
    if (seen.has(child)) {
      continue;
    }

    seen.add(child);
    children[writeIndex] = child;
    writeIndex += 1;
  }
  children.length = writeIndex;
}

function collectChild(value: unknown, discovered: AstNode[]): void {
  if (isAstNode(value)) {
    discovered.push(value);
    return;
  }

  if (!Array.isArray(value)) {
    return;
  }

  for (const entry of value) {
    if (isAstNode(entry)) {
      discovered.push(entry);
    }
  }
}

function compareBySourceOrder(left: AstNode, right: AstNode): number {
  const startOffset = left.span.start.offset - right.span.start.offset;
  if (startOffset !== 0) {
    return startOffset;
  }

  return left.span.end.offset - right.span.end.offset;
}

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type?: unknown }).type === "string" &&
    "span" in value &&
    typeof (value as { span?: SourceSpan }).span?.start.offset === "number" &&
    typeof (value as { span?: SourceSpan }).span?.end.offset === "number"
  );
}
