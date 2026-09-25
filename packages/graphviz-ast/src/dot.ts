export type Attributes = Record<string, string>;
export interface NodeRef {
  id: string;
  port?: string;
  compass?: string;
}
export interface NodeStatement {
  kind: "node";
  node: NodeRef;
  attributes: Attributes;
}
export interface EdgeStatement {
  kind: "edge";
  endpoints: (NodeRef | Subgraph)[];
  attributes: Attributes;
}
export interface AttributeStatement {
  kind: "attributes";
  target: "graph" | "node" | "edge";
  attributes: Attributes;
}
export interface Subgraph {
  kind: "subgraph";
  id?: string;
  statements: Statement[];
}
export type Statement = NodeStatement | EdgeStatement | AttributeStatement | Subgraph;
export interface DotGraph {
  kind: "graph";
  directed: boolean;
  strict: boolean;
  id?: string;
  statements: Statement[];
}
interface Token {
  value: string;
  kind: "id" | "html" | "quoted" | "symbol" | "eof";
  offset: number;
}
const compass = new Set(["n", "ne", "e", "se", "s", "sw", "w", "nw", "c", "_"]);
const whitespace = (c: string) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f";
const digit = (c: string) => c >= "0" && c <= "9";
const letter = (c: string) =>
  c === "_" || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c.charCodeAt(0) >= 128;

/** DOT lexer. HTML IDs are balanced tokens, not interpreted markup. */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const fail = (message: string): never => {
    throw new SyntaxError(`${message} at offset ${i}`);
  };
  while (i < source.length) {
    const c = source[i]!;
    if (whitespace(c)) {
      i++;
      continue;
    }
    if (c === "#" || source.startsWith("//", i)) {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) fail("Unterminated comment");
      i = end + 2;
      continue;
    }
    const offset = i;
    if (source.startsWith("->", i) || source.startsWith("--", i)) {
      tokens.push({ value: source.slice(i, i + 2), kind: "symbol", offset });
      i += 2;
      continue;
    }
    if ("{}[]=:;, +".includes(c)) {
      tokens.push({ value: c, kind: "symbol", offset });
      i++;
      continue;
    }
    if (c === '"') {
      let value = "";
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\") {
          i++;
          if (i === source.length) fail("Unterminated escape");
          if (source[i] === "\n") {
            i++;
            continue;
          }
          if (source[i] === "\r" && source[i + 1] === "\n") {
            i += 2;
            continue;
          }
          const escaped = source[i]!;
          value += escaped === '"' || escaped === "\\" ? escaped : "\\" + escaped;
          i++;
        } else value += source[i++]!;
      }
      if (source[i] !== '"') fail("Unterminated string");
      i++;
      tokens.push({ value, kind: "quoted", offset });
      continue;
    }
    if (c === "<") {
      let depth = 0;
      let quote = "";
      do {
        const ch = source[i++]!;
        if (quote) {
          if (ch === quote) quote = "";
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === "<") {
          if (source.startsWith("!--", i)) {
            const end = source.indexOf("-->", i + 3);
            if (end < 0) fail("Unterminated HTML comment");
            i = end + 3;
          } else depth++;
        } else if (ch === ">") depth--;
      } while (i < source.length && depth > 0);
      if (depth !== 0 || quote) fail("Unterminated HTML ID");
      tokens.push({ value: source.slice(offset, i), kind: "html", offset });
      continue;
    }
    if (letter(c)) {
      i++;
      while (i < source.length && (letter(source[i]!) || digit(source[i]!))) i++;
    } else if (digit(c) || c === "." || c === "-") {
      if (c === "-") i++;
      let digits = 0;
      while (i < source.length && digit(source[i]!)) {
        i++;
        digits++;
      }
      if (source[i] === ".") {
        i++;
        while (i < source.length && digit(source[i]!)) {
          i++;
          digits++;
        }
      }
      if (!digits) fail("Invalid numeric ID");
    } else fail("Unexpected character");
    tokens.push({ value: source.slice(offset, i), kind: "id", offset });
  }
  tokens.push({ value: "", kind: "eof", offset: source.length });
  return tokens;
}

export function parseDot(source: string): DotGraph {
  const tokens = tokenize(source);
  let position = 0;
  let nesting = 0;
  const peek = () => tokens[position]!;
  const fail = (message: string): never => {
    throw new SyntaxError(`${message} at offset ${peek().offset}`);
  };
  const accept = (value: string) => {
    if (peek().value !== value || peek().kind !== "symbol") return false;
    position++;
    return true;
  };
  const keyword = (value: string) => peek().kind === "id" && peek().value.toLowerCase() === value;
  const expect = (value: string) => {
    if (!accept(value)) fail(`Expected ${value}`);
  };
  const id = (): string => {
    const token = peek();
    if (!["id", "html", "quoted"].includes(token.kind)) fail("Expected ID");
    position++;
    let value = token.value;
    if (token.kind === "quoted")
      while (accept("+")) {
        if (peek().kind !== "quoted") fail("Expected quoted string after +");
        value += peek().value;
        position++;
      }
    return value;
  };
  const attrs = (): Attributes => {
    const result: Attributes = Object.create(null) as Attributes;
    while (accept("[")) {
      while (!accept("]")) {
        const key = id();
        expect("=");
        result[key] = id();
        accept(",");
        accept(";");
      }
    }
    return { ...result };
  };
  const ref = (name: string): NodeRef => {
    const result: NodeRef = { id: name };
    if (accept(":")) {
      const port = id();
      if (accept(":")) {
        result.port = port;
        result.compass = id();
        if (!compass.has(result.compass)) fail("Invalid compass point");
      } else if (compass.has(port)) result.compass = port;
      else result.port = port;
    }
    return result;
  };
  let strict = false;
  if (keyword("strict")) {
    strict = true;
    position++;
  }
  if (!keyword("digraph") && !keyword("graph")) fail("Expected graph or digraph");
  const directed = keyword("digraph");
  position++;
  const graph: DotGraph = { kind: "graph", directed, strict, statements: [] };
  if (peek().kind !== "symbol") graph.id = id();
  function subgraph(): Subgraph {
    const result: Subgraph = { kind: "subgraph", statements: [] };
    if (keyword("subgraph")) {
      position++;
      if (peek().value !== "{") result.id = id();
    }
    result.statements = statements();
    return result;
  }
  function statements(): Statement[] {
    if (++nesting > 256) fail("DOT nesting exceeds 256");
    expect("{");
    const result: Statement[] = [];
    while (!accept("}")) {
      if (accept(";") || accept(",")) continue;
      if (["graph", "node", "edge"].some(keyword) && tokens[position + 1]?.value === "[") {
        const target = peek().value.toLowerCase() as AttributeStatement["target"];
        position++;
        result.push({ kind: "attributes", target, attributes: attrs() });
        continue;
      }
      let endpoint: NodeRef | Subgraph;
      if (keyword("subgraph") || peek().value === "{") endpoint = subgraph();
      else {
        const name = id();
        if (accept("=")) {
          result.push({ kind: "attributes", target: "graph", attributes: { [name]: id() } });
          continue;
        }
        endpoint = ref(name);
      }
      if (peek().value === "->" || peek().value === "--") {
        const endpoints = [endpoint];
        while (peek().value === "->" || peek().value === "--") {
          if (peek().value !== (directed ? "->" : "--")) fail("Wrong edge operator for graph type");
          position++;
          endpoints.push(keyword("subgraph") || peek().value === "{" ? subgraph() : ref(id()));
        }
        result.push({ kind: "edge", endpoints, attributes: attrs() });
      } else if ("kind" in endpoint) result.push(endpoint);
      else result.push({ kind: "node", node: endpoint, attributes: attrs() });
      accept(";");
    }
    nesting--;
    return result;
  }
  graph.statements = statements();
  if (peek().kind !== "eof") fail("Trailing input");
  return graph;
}

function quote(value: string): string {
  if (value.startsWith("<") && value.endsWith(">")) return value;
  return '"' + value.split("\\").join("\\\\").split('"').join('\\"') + '"';
}
export function serializeDot(graph: DotGraph): string {
  const attributes = (values: Attributes) =>
    Object.keys(values).length
      ? " [" +
        Object.entries(values)
          .map(([key, value]) => `${quote(key)}=${quote(value)}`)
          .join(", ") +
        "]"
      : "";
  const reference = (node: NodeRef) =>
    quote(node.id) +
    (node.port !== undefined ? ":" + quote(node.port) : "") +
    (node.compass !== undefined ? ":" + node.compass : "");
  const sub = (value: Subgraph): string =>
    "subgraph" +
    (value.id !== undefined ? " " + quote(value.id) : "") +
    " {\n" +
    body(value.statements) +
    "}";
  const body = (statements: Statement[]): string =>
    statements
      .map((statement) => {
        if (statement.kind === "subgraph") return sub(statement) + ";\n";
        if (statement.kind === "node")
          return reference(statement.node) + attributes(statement.attributes) + ";\n";
        if (statement.kind === "edge")
          return (
            statement.endpoints
              .map((endpoint) => ("kind" in endpoint ? sub(endpoint) : reference(endpoint)))
              .join(graph.directed ? " -> " : " -- ") +
            attributes(statement.attributes) +
            ";\n"
          );
        return statement.target + attributes(statement.attributes) + ";\n";
      })
      .join("");
  return (
    (graph.strict ? "strict " : "") +
    (graph.directed ? "digraph" : "graph") +
    (graph.id !== undefined ? " " + quote(graph.id) : "") +
    " {\n" +
    body(graph.statements) +
    "}\n"
  );
}
