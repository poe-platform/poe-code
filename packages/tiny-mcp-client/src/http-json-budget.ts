/**
 * Admission scan only: native JSON.parse still owns JSON grammar validation.
 * No strings or object graph are materialized here. Count keys as well as values,
 * including duplicate keys, and reserve 128 bytes per token/container plus UTF-16
 * string storage. These conservative estimates are ceilings, not heap guarantees.
 * Fixed per-message limits also protect Worker hosts using the default transport.
 */
export function assertHttpJsonBudget(text: string): void {
  let nodes = 0;
  let allocation = 0;
  let decodedBytes = 0;
  const stack: string[] = [];
  const whitespace = (c: string) => c === " " || c === "\t" || c === "\r" || c === "\n";
  const check = () => {
    if (nodes > 100_000 || stack.length > 64 || allocation > 8 * 1024 * 1024 || decodedBytes > 4 * 1024 * 1024)
      throw new Error("MCP HTTP JSON structural budget exceeded");
  };
  for (let i = 0; i < text.length;) {
    const c = text[i++];
    if (whitespace(c) || c === "," || c === ":") continue;
    if (c === "}" || c === "]") {
      if (stack.pop() !== c) throw new SyntaxError("Malformed MCP HTTP JSON nesting");
      continue;
    }
    nodes++;
    allocation += 128;
    if (c === "{" || c === "[") {
      stack.push(c === "{" ? "}" : "]");
      check();
      continue;
    }
    check();
    if (c === '"') {
      let closed = false;
      while (i < text.length) {
        const character = text[i++];
        if (character === '"') { closed = true; break; }
        if (character.charCodeAt(0) < 32) throw new SyntaxError("Malformed MCP HTTP JSON string");
        if (character === "\\") {
          const escape = text[i++];
          if (escape === "u") {
            for (let digit = 0; digit < 4; digit++) {
              const hex = text[i++];
              if (hex === undefined || !"0123456789abcdefABCDEF".includes(hex))
                throw new SyntaxError("Malformed MCP HTTP JSON escape");
            }
          } else if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
            throw new SyntaxError("Malformed MCP HTTP JSON escape");
          }
        }
        decodedBytes += 2;
        allocation += 2;
        check();
      }
      if (!closed) throw new SyntaxError("Unterminated MCP HTTP JSON string");
    } else {
      // Scalars cannot allocate nested objects; JSON.parse validates their syntax.
      while (i < text.length && !whitespace(text[i]) && !'{}[],:"'.includes(text[i])) i++;
    }
  }
  if (stack.length !== 0) throw new SyntaxError("Unterminated MCP HTTP JSON container");
}
