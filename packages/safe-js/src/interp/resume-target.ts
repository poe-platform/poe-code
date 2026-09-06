import type { ParseResult } from "../parse.js";

export function containsResumeTarget(node: ParseResult, targetNodeIds: ReadonlySet<number>): boolean {
  if (node.nodeId !== undefined && targetNodeIds.has(node.nodeId)) {
    return true;
  }
  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression"
  ) {
    return false;
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      if (
        value.some((entry) => isParseResult(entry) && containsResumeTarget(entry, targetNodeIds))
      ) {
        return true;
      }
      continue;
    }
    if (isParseResult(value) && containsResumeTarget(value, targetNodeIds)) {
      return true;
    }
  }

  return false;
}

function isParseResult(value: unknown): value is ParseResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    Object.hasOwn(value, "span")
  );
}
