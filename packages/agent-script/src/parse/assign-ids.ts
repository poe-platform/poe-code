import type { ParseResult, SourceSpan } from "./parser.js";

type AstNode = {
  nodeId?: number;
  span: SourceSpan;
  type: string;
  [key: string]: unknown;
};

type OrderedNode = {
  node: AstNode;
  order: number;
};

export function assignIds(root: ParseResult): ParseResult {
  const visited = new Set<AstNode>();
  let nextId = 0;

  visit(root);
  return root;

  function visit(node: AstNode): void {
    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    Object.defineProperty(node, "nodeId", {
      value: nextId,
      writable: true,
      configurable: true,
      enumerable: false
    });
    nextId += 1;

    for (const child of getChildren(node)) {
      visit(child);
    }
  }
}

function getChildren(node: AstNode): AstNode[] {
  const discovered: OrderedNode[] = [];

  for (const [key, value] of Object.entries(node)) {
    if (key === "nodeId" || key === "span" || key === "type") {
      continue;
    }

    collectChild(value, discovered);
  }

  const seen = new Set<AstNode>();
  return discovered
    .sort(compareBySourceOrder)
    .filter(({ node: child }) => {
      if (seen.has(child)) {
        return false;
      }

      seen.add(child);
      return true;
    })
    .map(({ node: child }) => child);
}

function collectChild(value: unknown, discovered: OrderedNode[]): void {
  if (isAstNode(value)) {
    discovered.push({ node: value, order: discovered.length });
    return;
  }

  if (!Array.isArray(value)) {
    return;
  }

  for (const entry of value) {
    if (isAstNode(entry)) {
      discovered.push({ node: entry, order: discovered.length });
    }
  }
}

function compareBySourceOrder(left: OrderedNode, right: OrderedNode): number {
  const startOffset = left.node.span.start.offset - right.node.span.start.offset;
  if (startOffset !== 0) {
    return startOffset;
  }

  const endOffset = left.node.span.end.offset - right.node.span.end.offset;
  if (endOffset !== 0) {
    return endOffset;
  }

  return left.order - right.order;
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
