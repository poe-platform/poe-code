import { JqError, JqLimitError, wellFormed, type Budget, type Json } from "./limits.js";
import { decimalNumber } from "./numbers.js";

export type Ast =
  | { kind: "parameter"; name: string }
  | { kind: "invoke"; parameters: Ast[]; args: Ast[]; body: Ast }
  | { kind: "format"; name: string }
  | { kind: "identity" }
  | { kind: "literal"; value: Json }
  | { kind: "variable"; name: string }
  | { kind: "bind"; source: Ast; name: string; body: Ast }
  | { kind: "binary"; operator: string; left: Ast; right: Ast }
  | { kind: "unary"; operand: Ast }
  | { kind: "optional"; operand: Ast }
  | { kind: "descend" }
  | { kind: "try"; body: Ast; handler: Ast | undefined }
  | { kind: "reduce" | "foreach"; source: Ast; name: string; init: Ast; update: Ast; extract: Ast | undefined }
  | { kind: "index"; base: Ast; index: Ast }
  | { kind: "slice"; base: Ast; start: Ast | undefined; end: Ast | undefined }
  | { kind: "iterate"; base: Ast }
  | { kind: "array"; body: Ast | undefined }
  | { kind: "object"; fields: { key: Ast; value: Ast | undefined }[] }
  | { kind: "call"; name: string; args: Ast[] }
  | { kind: "if"; condition: Ast; yes: Ast; no: Ast };
interface Token { text: string; offset: number; kind: "symbol" | "name" | "number" | "string" | "end" }
const precedence: Readonly<Record<string, number>> = Object.freeze({
  "|": 1, ",": 2, "=": 3, "|=": 3, "+=": 3, "-=": 3, "*=": 3, "/=": 3, "%=": 3, "//=": 3,
  "//": 4, or: 5, and: 6, "==": 7, "!=": 7, "<": 7, ">": 7, "<=": 7, ">=": 7,
  "+": 8, "-": 8, "*": 9, "/": 9, "%": 9,
});
export const functions: Readonly<Record<string, readonly number[]>> = Object.freeze({
  fromdateiso8601: [0], todateiso8601: [0],
  scan: [1], paths: [0, 1], getpath: [1], flatten: [0, 1], del: [1], error: [0, 1], startswith: [1], endswith: [1], ltrimstr: [1], rtrimstr: [1], ascii_downcase: [0], ascii_upcase: [0],
  setpath: [2], empty: [0], select: [1], map: [1], map_values: [1], length: [0], keys: [0], keys_unsorted: [0], values: [0],
  type: [0], has: [1], contains: [1], bsearch: [1], sort: [0], sort_by: [1], unique: [0], unique_by: [1], group_by: [1], add: [0],
  not: [0], reverse: [0], transpose: [0], first: [0, 1], last: [0, 1], limit: [2], range: [1, 2, 3], join: [1], split: [1], gsub: [2, 3],
  tostring: [0], tonumber: [0], tojson: [0], fromjson: [0], to_entries: [0], from_entries: [0], with_entries: [1],
  min: [0], max: [0], min_by: [1], max_by: [1], any: [0, 1, 2], all: [0, 1, 2],
  strings: [0], numbers: [0], booleans: [0], arrays: [0], objects: [0], nulls: [0], scalars: [0], iterables: [0],
  nan: [0], infinite: [0], isnan: [0], isinfinite: [0], isfinite: [0],
});
function tokenize(source: string, budget: Budget): Token[] {
  const tokens: Token[] = [];
  const modes: ({ kind: "string"; start: number; segment: number; interpolated: boolean } | { kind: "expression"; parentheses: number })[] = [];
  const stringToken = (start: number, end: number): Token => {
    let text = '"';
    for (let index = start; index < end; index++) {
      const character = source[index]!;
      text += character.charCodeAt(0) < 32 ? `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}` : character;
    }
    text += '"';
    try { if (!wellFormed(JSON.parse(text) as string)) throw new Error(); } catch { throw new JqError(`invalid string at offset ${start - 1}`, 3); }
    return { text, offset: start - 1, kind: "string" };
  };
  let offset = 0;
  while (offset < source.length) {
    budget.step();
    const character = source[offset]!;
    const mode = modes.at(-1);
    if (mode?.kind === "string") {
      if (character === '"') {
        tokens.push(stringToken(mode.segment, offset));
        if (mode.interpolated) tokens.push({ text: "string-end", offset, kind: "symbol" });
        modes.pop(); offset++; continue;
      }
      if (character === "\\" && source[offset + 1] === "(") {
        if (!mode.interpolated) tokens.push({ text: "string-start", offset: mode.start, kind: "symbol" });
        mode.interpolated = true;
        tokens.push(stringToken(mode.segment, offset), { text: "interpolation-start", offset, kind: "symbol" });
        modes.push({ kind: "expression", parentheses: 0 }); offset += 2;
        if (modes.length > budget.limits.maxAstDepth) throw new JqLimitError("maxAstDepth");
        continue;
      }
      offset += character === "\\" ? 2 : 1;
      continue;
    }
    if (mode?.kind === "expression") {
      if (character === "(") mode.parentheses++;
      else if (character === ")") {
        if (mode.parentheses === 0) {
          tokens.push({ text: "interpolation-end", offset, kind: "symbol" });
          modes.pop(); offset++;
          const string = modes.at(-1)!;
          if (string.kind === "string") string.segment = offset;
          continue;
        }
        mode.parentheses--;
      }
    }
    if (/\s/u.test(character)) { offset++; continue; }
    if (character === "#") { while (offset < source.length && source[offset] !== "\n") offset++; continue; }
    const start = offset;
    if (character === '"') {
      modes.push({ kind: "string", start, segment: ++offset, interpolated: false });
      if (modes.length > budget.limits.maxAstDepth) throw new JqLimitError("maxAstDepth");
      continue;
    }
    const number = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/u.exec(source.slice(offset));
    if (number) {
      tokens.push({ text: number[0], offset, kind: "number" }); offset += number[0].length; continue;
    }
    const name = /^[A-Za-z_][A-Za-z_0-9]*/u.exec(source.slice(offset));
    if (name) { tokens.push({ text: name[0], offset, kind: "name" }); offset += name[0].length; continue; }
    if (character === "@") { tokens.push({ text: "@", offset, kind: "symbol" }); offset++; continue; }
    if (source.startsWith("..", offset)) {
      tokens.push({ text: "..", offset, kind: "symbol" }); offset += 2; continue;
    }
    if (source.startsWith("::", offset)) {
      tokens.push({ text: "::", offset, kind: "symbol" }); offset += 2; continue;
    }
    const symbol = /^(?:\/\/=|\|=|\+=|-=|\*=|\/=|%=|==|!=|<=|>=|\/\/|[.\[\]{}(),:;?$|+*/%<>=-])/u.exec(source.slice(offset));
    if (!symbol) throw new JqError(`unexpected character at offset ${offset}`, 3);
    tokens.push({ text: symbol[0], offset, kind: "symbol" }); offset += symbol[0].length;
  }
  if (modes.length) throw new JqError(`unterminated string or interpolation at offset ${offset}`, 3);
  tokens.push({ text: "", offset, kind: "end" });
  return tokens;
}
function isPath(ast: Ast): boolean {
  const pending = [ast];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === "identity" || node.kind === "parameter" || node.kind === "invoke" || node.kind === "descend") continue;
    if (node.kind === "index" || node.kind === "iterate" || node.kind === "slice") pending.push(node.base);
    else if (node.kind === "optional") pending.push(node.operand);
    else if (node.kind === "call" && ["select", "values", "strings", "numbers", "booleans", "arrays", "objects", "nulls", "scalars", "iterables", "empty"].includes(node.name)) continue;
    else if (node.kind === "binary" && (node.operator === "," || node.operator === "|")) pending.push(node.left, node.right);
    else return false;
  }
  return true;
}
export function moduleProgram(source: string, budget: Budget): { source: string; imports: { name: string; alias?: string }[] } {
  if (Buffer.byteLength(source) > budget.limits.maxSourceBytes) throw new JqLimitError("maxSourceBytes");
  const tokens = tokenize(source, budget);
  const imports: { name: string; alias?: string }[] = [];
  let position = 0;
  while (tokens[position]!.text === "include" || tokens[position]!.text === "import") {
    budget.step();
    const directive = tokens[position++]!.text;
    const name = tokens[position++];
    if (name?.kind !== "string") throw new JqError("module directive requires a string path", 3);
    const entry: { name: string; alias?: string } = { name: JSON.parse(name.text) as string };
    if (directive === "import") {
      if (tokens[position++]?.text !== "as") throw new JqError("import requires a namespace", 3);
      const alias = tokens[position++];
      if (alias?.kind !== "name") throw new JqError("import requires a namespace", 3);
      entry.alias = alias.text;
    }
    if (tokens[position++]?.text !== ";") throw new JqError("module directive requires ';'", 3);
    imports.push(entry);
    budget.collection(imports.length);
  }
  return { source: source.slice(tokens[position]!.offset), imports };
}

export function parse(source: string, variables: ReadonlyMap<string, Json>, budget: Budget, definitions: Map<string, Ast> = new Map(), module = false): Ast {
  const limits = budget.limits;
  if (Buffer.byteLength(source) > limits.maxSourceBytes) throw new JqLimitError("maxSourceBytes");
  const tokens = tokenize(source, budget);
  let position = 0;
  let nesting = 0;
  let defining = false;
  const unresolved = new Map<Ast, Token>();
  const bindings = new Map<string, number>();
  const parameters = new Map<string, Ast>();
  const peek = (): Token => tokens[Math.min(position, tokens.length - 1)]!;
  const take = (): Token => { const token = peek(); if (token.kind !== "end") position++; return token; };
  const accept = (text: string): boolean => { if (peek().text !== text) return false; take(); return true; };
  const fail = (message: string): never => { throw new JqError(`${message} at offset ${peek().offset}`, 3); };
  const diagnostic = (token: Token, message: string): string => {
    const prefix = source.slice(0, token.offset);
    const line = prefix.split("\n").length;
    const start = prefix.lastIndexOf("\n") + 1;
    const end = source.indexOf("\n", start);
    const context = source.slice(start, end < 0 ? source.length : end);
    return `error: ${message} at <top-level>, line ${line}:\n${context}${" ".repeat(Buffer.byteLength(prefix.slice(start)))}`;
  };
  const syntaxError = (token: Token, expectEnd = false): never => {
    const name = token.kind === "end" ? "end of file" : token.kind === "name" ? "IDENT" : token.kind === "number" || token.kind === "string" ? "LITERAL" : `'${token.text}'`;
    const location = token.kind === "end" ? tokens[Math.max(0, position - 1)]! : token;
    throw new JqError(`${diagnostic(location, `syntax error, unexpected ${name}${expectEnd ? ", expecting end of file" : ""} (Unix shell quoting issues?)`)}\njq: 1 compile error`, 3);
  };
  const expect = (text: string): void => { if (!accept(text)) fail(`expected '${text}'`); };
  const literal = (value: Json): Ast => ({ kind: "literal", value });
  const variable = (name: Token): Ast => {
    if (name.kind !== "name") fail("expected variable name");
    if (!bindings.has(name.text) && !variables.has(name.text)) fail(`undefined variable $${name.text}`);
    return defining && !bindings.has(name.text) ? literal(variables.get(name.text)!) : { kind: "variable", name: name.text };
  };
  const conditional = (): Ast => {
    const condition = expression(); expect("then");
    const yes = expression();
    if (accept("elif")) return { kind: "if", condition, yes, no: guardedConditional() };
    const no: Ast = accept("else") ? expression() : { kind: "identity" }; expect("end");
    return { kind: "if", condition, yes, no };
  };
  const guardedConditional = (): Ast => {
    if (++nesting > limits.maxAstDepth) throw new JqLimitError("maxAstDepth");
    try { return conditional(); } finally { nesting--; }
  };
  const expression = (minimum = 0, stopComma = false): Ast => {
    if (++nesting > limits.maxAstDepth) throw new JqLimitError("maxAstDepth");
    try {
      let left = primary();
      while (true) {
        const operator = peek().text;
        if (operator === "as" && minimum <= 3) {
          take(); expect("$");
          const name = take(); if (name.kind !== "name") fail("expected variable name");
          expect("|");
          const previous = bindings.get(name.text) ?? 0;
          bindings.set(name.text, previous + 1);
          try { left = { kind: "bind", source: left, name: name.text, body: expression(0, stopComma) }; }
          finally { if (previous) bindings.set(name.text, previous); else bindings.delete(name.text); }
          continue;
        }
        const priority = Object.hasOwn(precedence, operator) ? precedence[operator]! : -1;
        if (priority < minimum || (stopComma && operator === ",")) break;
        take();
        const assignment = priority === 3;
        if (assignment && !isPath(left)) fail("unsupported assignment path");
        const right = expression(priority + (assignment ? 0 : 1), stopComma);
        left = { kind: "binary", operator, left, right };
      }
      return left;
    } finally { nesting--; }
  };
  const stringExpression = (token: Token, format = "text"): Ast => {
    if (token.kind === "string") return literal(JSON.parse(token.text) as string);
    let result = stringExpression(take(), format);
    while (accept("interpolation-start")) {
      const value: Ast = { kind: "format", name: format };
      const interpolated: Ast = { kind: "binary", operator: "|", left: expression(), right: value };
      expect("interpolation-end");
      result = { kind: "binary", operator: "+", left: result, right: interpolated };
      result = { kind: "binary", operator: "+", left: result, right: stringExpression(take()) };
    }
    expect("string-end");
    return result;
  };
  const primary = (): Ast => {
    const token = take();
    let result: Ast;
    if (token.text === "@") {
      const name = take();
      if (name.kind !== "name") fail("expected format name");
      result = peek().kind === "string" || peek().text === "string-start" ? stringExpression(take(), name.text) : { kind: "format", name: name.text };
    } else if (token.text === "..") result = { kind: "descend" };
    else if (token.text === "try") {
      const body = expression(10);
      result = { kind: "try", body, handler: accept("catch") ? expression(10) : undefined };
    } else if (token.text === "reduce" || token.text === "foreach") {
      const source = expression(10); expect("as"); expect("$");
      const name = take(); if (name.kind !== "name") fail("expected variable name");
      expect("("); const init = expression(); expect(";");
      const previous = bindings.get(name.text) ?? 0;
      bindings.set(name.text, previous + 1);
      try {
        const update = expression();
        const extract = token.text === "foreach" && accept(";") ? expression() : undefined;
        expect(")");
        result = { kind: token.text, source, name: name.text, init, update, extract };
      } finally {
        if (previous) bindings.set(name.text, previous);
        else bindings.delete(name.text);
      }
    } else if (token.text === ".") {
      result = { kind: "identity" };
      if ((peek().kind === "name" && peek().offset === token.offset + 1) || peek().kind === "string") {
        const key = take(); result = { kind: "index", base: result, index: literal(key.kind === "string" ? JSON.parse(key.text) as string : key.text) };
      }
    } else if (token.text === "(") { result = expression(); expect(")"); }
    else if (token.text === "[") {
      result = { kind: "array", body: peek().text === "]" ? undefined : expression() }; expect("]");
    } else if (token.text === "{") {
      const fields: { key: Ast; value: Ast | undefined }[] = [];
      while (peek().text !== "}") {
        const keyToken = take();
        let key: Ast;
        let shorthand: Ast | undefined;
        if (keyToken.text === "(") { key = expression(); expect(")"); }
        else if (keyToken.text === "$") {
          const name = take();
          shorthand = variable(name);
          key = peek().text === ":" ? shorthand : literal(name.text);
        }
        else if (keyToken.kind === "string" || keyToken.text === "string-start") key = stringExpression(keyToken);
        else if (keyToken.kind === "name") key = literal(keyToken.text);
        else fail("expected object key");
        const value = accept(":") ? expression(0, true) : shorthand ?? (keyToken.text === "(" ? fail("expected ':'") : undefined);
        fields.push({ key: key!, value });
        if (!accept(",")) break;
      }
      expect("}"); result = { kind: "object", fields };
    } else if (token.text === "$") {
      result = variable(take());
    } else if (token.text === "-") result = { kind: "unary", operand: expression(10) };
    else if (token.text === "if") result = guardedConditional();
    else if (token.kind === "string" || token.text === "string-start") result = stringExpression(token);
    else if (token.kind === "number") {
      result = literal(decimalNumber(token.text, budget));
    } else if (["true", "false", "null"].includes(token.text)) result = literal(JSON.parse(token.text) as Json);
    else if (token.kind === "name") {
      let name = token.text;
      if (accept("::")) {
        const member = take();
        if (member.kind !== "name") fail("expected namespace member");
        name += `::${member.text}`;
      }
      const args: Ast[] = [];
      if (accept("(")) { if (peek().text !== ")") do { args.push(expression()); } while (accept(";")); expect(")"); }
      if (token.text === "split" && args.length === 2) fail("unsupported function split/2");
      const definition = definitions?.get(name);
      const parameter = parameters.get(name);
      if (parameter && !args.length) result = parameter;
      else if (definition?.kind === "invoke" && definition.parameters.length === args.length) result = { ...definition, args };
      else if (definition && definition.kind !== "invoke" && !args.length) result = definition;
      else {
        result = { kind: "call", name, args };
        if (!Object.hasOwn(functions, name) || !functions[name]!.includes(args.length)) unresolved.set(result, token);
      }
    } else syntaxError(token, nesting === 1);
    while (true) {
      if (accept("?")) result = { kind: "optional", operand: result! };
      else if (accept(".")) {
        const key = take(); if (key.kind !== "name" && key.kind !== "string") fail("expected property name");
        result = { kind: "index", base: result!, index: literal(key.kind === "string" ? JSON.parse(key.text) as string : key.text) };
      } else if (accept("[")) {
        if (accept("]")) result = { kind: "iterate", base: result! };
        else {
          const start = peek().text === ":" ? undefined : expression();
          if (accept(":")) {
            const end = peek().text === "]" ? undefined : expression(); expect("]");
            result = { kind: "slice", base: result!, start, end };
          } else { expect("]"); result = { kind: "index", base: result!, index: start! }; }
        }
      } else break;
    }
    return result!;
  };
  const bodies: Ast[] = [];
  while (definitions && accept("def")) {
    budget.step();
    const name = take();
    if (name.kind !== "name") fail("expected function name");
    const formal: Ast[] = [];
    const values: string[] = [];
    if (accept("(")) {
      do {
        const value = accept("$");
        const parameter = take();
        if (parameter.kind !== "name" || parameters.has(parameter.text) || parameters.has(`$${parameter.text}`)) fail("expected unique parameter name");
        const node: Ast = { kind: "parameter", name: parameter.text };
        parameters.set(value ? `$${parameter.text}` : parameter.text, node);
        formal.push(node);
        values.push(value ? parameter.text : "");
        if (value) bindings.set(parameter.text, 1);
        budget.collection(formal.length);
      } while (accept(";"));
      expect(")");
    }
    expect(":");
    defining = true;
    let body: Ast;
    try { body = expression(); } finally { defining = false; }
    expect(";");
    for (let index = formal.length - 1; index >= 0; index--) {
      if (values[index]) body = { kind: "bind", name: values[index]!, source: formal[index]!, body };
    }
    parameters.clear();
    for (const value of values) if (value) bindings.delete(value);
    definitions.set(name.text, formal.length ? { kind: "invoke", parameters: formal, args: [], body } : body);
    budget.collection(definitions.size);
    bodies.push(body);
  }
  if (module && peek().kind !== "end") fail("module must contain only imports and definitions");
  const ast = module ? { kind: "identity" as const } : expression();
  if (peek().kind !== "end") syntaxError(peek(), true);
  const pending: { node: Ast; depth: number }[] = [ast, ...bodies].map(node => ({ node, depth: 1 }));
  const errors: string[] = [];
  let errorBytes = 0;
  while (pending.length) {
    budget.step();
    const { node, depth } = pending.pop()!;
    if (depth > limits.maxAstDepth) throw new JqLimitError("maxAstDepth");
    const token = unresolved.get(node);
    if (token && node.kind === "call") {
      const message = diagnostic(token, `${node.name}/${node.args.length} is not defined`);
      errorBytes += Buffer.byteLength(message) + 5;
      if (errorBytes > limits.maxOutputBytes) throw new JqLimitError("maxOutputBytes");
      errors.push(message);
      continue;
    }
    const children: Ast[] = [];
    if (node.kind === "invoke") children.push(node.body, ...node.args);
    else if (node.kind === "binary") children.push(node.left, node.right);
    else if (node.kind === "bind") children.push(node.source, node.body);
    else if (node.kind === "unary" || node.kind === "optional") children.push(node.operand);
    else if (node.kind === "index") children.push(node.base, node.index);
    else if (node.kind === "iterate") children.push(node.base);
    else if (node.kind === "slice") { children.push(node.base); if (node.start) children.push(node.start); if (node.end) children.push(node.end); }
    else if (node.kind === "array" && node.body) children.push(node.body);
    else if (node.kind === "object") for (const field of node.fields) { children.push(field.key); if (field.value) children.push(field.value); }
    else if (node.kind === "call") children.push(...node.args);
    else if (node.kind === "if") children.push(node.condition, node.yes, node.no);
    else if (node.kind === "try") { children.push(node.body); if (node.handler) children.push(node.handler); }
    else if (node.kind === "reduce" || node.kind === "foreach") {
      children.push(node.source, node.init, node.update);
      if (node.extract) children.push(node.extract);
    }
    for (const child of children.reverse()) pending.push({ node: child, depth: depth + 1 });
  }
  if (errors.length) throw new JqError(`${errors.join("\njq: ")}\njq: ${errors.length} compile error${errors.length === 1 ? "" : "s"}`, 3);
  return ast;
}
