/** Scan only the grammar boundaries needed by the synchronous jq subset. */
export function splitSyncJqExpression(expression: string, separator: string): { parts: string[]; wrapped: boolean } | undefined {
  const parts: string[] = [];
  const stack: string[] = [];
  let quoted = false;
  let escaped = false;
  let start = 0;
  let wrapped = expression.startsWith("(");
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push(ch === "(" ? ")" : ch === "[" ? "]" : "}");
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== ch) return undefined;
      if (stack.length === 0 && i !== expression.length - 1) wrapped = false;
      continue;
    }
    if (stack.length === 0 && expression.startsWith(separator, i)) {
      parts.push(expression.slice(start, i).trim());
      i += separator.length - 1;
      start = i + 1;
    }
  }
  if (quoted || stack.length > 0) return undefined;
  parts.push(expression.slice(start).trim());
  return { parts, wrapped };
}
