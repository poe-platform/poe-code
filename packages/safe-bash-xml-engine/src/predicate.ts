import { XmlBudget, XmlQueryError } from "./limits.js";
import type { Query } from "./query.js";
import { stringValue, type Node } from "./evaluate.js";

export interface NodeSelection {
  readonly size: number;
  nodes(): AsyncIterable<Node> | Iterable<Node>;
}
export type Value = string | number | boolean | NodeSelection;
type Selector = (query: Query, absolute: boolean) => Promise<Node[] | NodeSelection>;
type Operator = "+" | "-" | "or" | "and" | "=" | "!=" | "<" | "<=" | ">" | ">=";
type FunctionName = keyof typeof arity;
export type Instruction =
  | { kind: "path"; source: string; query?: Query }
  | { kind: "negate" }
  | { kind: "literal"; value: string | number }
  | { kind: "operator"; name: Operator }
  | { kind: "function"; name: FunctionName; count: number };
const precedence: Record<Operator, number> = { "+": 5, "-": 5, or: 1, and: 2, "=": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4 };
const arity = {
  contains: [2], "starts-with": [2], "normalize-space": [0, 1], not: [1],
  position: [0], last: [0], concat: [2, Infinity], substring: [2, 3],
  "substring-before": [2], "substring-after": [2], translate: [3],
  "string-length": [0, 1], string: [0, 1], count: [1], boolean: [1],
  true: [0], false: [0], number: [0, 1], sum: [1], floor: [1],
  ceiling: [1], round: [1], name: [0, 1], "local-name": [0, 1], "namespace-uri": [0, 1]
} satisfies Record<string, number[]>;

const whitespace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r";
const digit = (c: string): boolean => c >= "0" && c <= "9";
const nameStart = (c: string): boolean => c >= "a" && c <= "z" || c >= "A" && c <= "Z" || c === "_";
const namePart = (c: string): boolean => nameStart(c) || digit(c) || c === "-" || c === ".";

/** Shunting-yard compilation keeps adversarial expression nesting off the JS stack. */
export function parsePredicate(source: string, budget: XmlBudget): readonly Instruction[] {
  const output: Instruction[] = [];
  const stack: ({ kind: "negate" } | { kind: "operator"; name: Operator } | { kind: "group"; name?: FunctionName; commas: number })[] = [];
  let at = 0, expecting = true, depth = 0;
  const fail = (): never => { throw new XmlQueryError(`unsupported XPath predicate at offset ${at}`, 10); };
  const space = (): void => { while (whitespace(source[at] ?? "")) at++; };
  const name = (): string => {
    const start = at;
    if (!nameStart(source[at] ?? "")) fail();
    while (namePart(source[at] ?? "")) at++;
    return source.slice(start, at);
  };
  const flush = (): void => {
    while (stack.at(-1)?.kind === "operator" || stack.at(-1)?.kind === "negate") output.push(stack.pop()! as Instruction);
  };
  while (true) {
    space();
    if (at === source.length) break;
    const c = source[at]!;
    if (c === ")") {
      if (expecting && stack.at(-1)?.kind !== "group") fail();
      flush();
      const group = stack.pop();
      if (!group || group.kind !== "group") return fail();
      if (expecting && (group.commas > 0 || group.name === undefined)) fail();
      const count = expecting ? 0 : group.commas + 1;
      if (group.name !== undefined) {
        if (!(group.name === "concat" ? count >= 2 : arity[group.name].includes(count))) fail();
        output.push({ kind: "function", name: group.name, count });
      }
      depth--; at++; expecting = false; continue;
    }
    if (c === ",") {
      if (expecting) fail();
      flush();
      const group = stack.at(-1);
      if (!group || group.kind !== "group" || group.name === undefined) return fail();
      group.commas++; at++; expecting = true; continue;
    }
    if (!expecting) {
      let operator: string;
      if (c === "+" || c === "-") { operator = c; at++; }
      else if (c === "=" || c === "!" || c === "<" || c === ">") {
        operator = c; at++;
        if (source[at] === "=") { operator += "="; at++; }
      } else operator = name();
      if (!Object.hasOwn(precedence, operator)) fail();
      const selected = operator as Operator;
      while (stack.at(-1)?.kind === "operator" || stack.at(-1)?.kind === "negate") {
        if (stack.at(-1)?.kind === "negate") { output.push(stack.pop()! as Instruction); continue; }
        const top = stack.at(-1)! as { kind: "operator"; name: Operator };
        if (precedence[top.name] < precedence[selected]) break;
        output.push(stack.pop()! as Instruction);
      }
      stack.push({ kind: "operator", name: selected }); expecting = true; continue;
    }
    if (c === "-") { stack.push({ kind: "negate" }); at++; continue; }
    let probe = at;
    while (namePart(source[probe] ?? "")) probe++;
    while (whitespace(source[probe] ?? "")) probe++;
    const pathStart = c === "/" || c === "@" || c === "." && !digit(source[at + 1] ?? "") ||
      nameStart(c) && (source[probe] !== "(" || source.startsWith("text", at));
    if (pathStart) {
      const start = at;
      let brackets = 0, parentheses = 0, quote = "";
      while (at < source.length) {
        const ch = source[at]!;
        if (quote) { if (ch === quote) quote = ""; }
        else if (ch === "'" || ch === '"') quote = ch;
        else if (ch === "[") brackets++;
        else if (ch === "]") brackets--;
        else if (!brackets && ch === "(") parentheses++;
        else if (!brackets && ch === ")") { if (!parentheses) break; parentheses--; }
        else if (!brackets && !parentheses && (ch === "+" || ch === "," || ch === "=" || ch === "!" || ch === "<" || ch === ">" )) break;
        if (!quote && !brackets && !parentheses && whitespace(ch)) {
          let next = at;
          while (whitespace(source[next] ?? "")) next++;
          let previous = at - 1;
          while (previous >= start && whitespace(source[previous]!)) previous--;
          if (!"/|".includes(source[next] ?? " ") && !"/|".includes(source[previous] ?? " ")) break;
        }
        at++;
      }
      output.push({ kind: "path", source: source.slice(start, at) });
      expecting = false;
      continue;
    }
    if (c === "(") { stack.push({ kind: "group", commas: 0 }); depth++; at++; }
    else if (c === "'" || c === '"') {
      const start = ++at;
      while (at < source.length && source[at] !== c) at++;
      if (at === source.length) fail();
      output.push({ kind: "literal", value: source.slice(start, at++) }); expecting = false;
    } else if (digit(c) || c === "." && digit(source[at + 1] ?? "")) {
      const start = at;
      let digits = 0;
      while (digit(source[at] ?? "")) { at++; digits++; }
      if (source[at] === ".") { at++; while (digit(source[at] ?? "")) { at++; digits++; } }
      if (!digits) fail();
      output.push({ kind: "literal", value: Number(source.slice(start, at)) }); expecting = false;
    } else {
      const selected = name(); space();
      if (source[at++] !== "(" || !Object.hasOwn(arity, selected)) fail();
      stack.push({ kind: "group", name: selected as FunctionName, commas: 0 });
      depth++;
    }
    if (depth > budget.limits.maxDepth)
      throw new XmlQueryError("maxDepth limit exceeded", 5);
  }
  if (expecting) fail();
  flush();
  if (stack.length) fail();
  return output;
}
const isSelection = (value: Value): value is NodeSelection => typeof value === "object";
const boolean = (value: Value): boolean => isSelection(value) ? value.size > 0 : typeof value === "number" ? value !== 0 && !Number.isNaN(value) : Boolean(value);

export async function expressionString(value: Value, budget: XmlBudget): Promise<string> {
  if (!isSelection(value)) return String(value);
  for await (const node of value.nodes()) {
    let text = "";
    for await (const part of stringValue(node, budget)) {
      const checkpoint = budget.tick(part.length); if (checkpoint) await checkpoint;
      text += part;
    }
    return text;
  }
  return "";
}

const number = async (value: Value, budget: XmlBudget): Promise<number> => {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const source = await expressionString(value, budget);
  let start = 0, end = source.length;
  while (start < end && whitespace(source[start]!)) start++;
  while (end > start && whitespace(source[end - 1]!)) end--;
  const text = source.slice(start, end);
  let at = text.startsWith("-") ? 1 : 0, digits = 0;
  while (digit(text[at] ?? "")) { at++; digits++; }
  if (text[at] === ".") { at++; while (digit(text[at] ?? "")) { at++; digits++; } }
  if (!digits) return NaN;
  if (text[at] === "e" || text[at] === "E") {
    at++;
    if (text[at] === "+" || text[at] === "-") at++;
    const start = at;
    while (digit(text[at] ?? "")) at++;
    if (at === start) return NaN;
  }
  return at === text.length ? Number(text) : NaN;
};
async function* comparisonValues(value: Value, budget: XmlBudget): AsyncGenerator<string | number | boolean> {
  if (!isSelection(value)) { yield value; return; }
  for await (const node of value.nodes())
    yield await expressionString({ size: 1, nodes: () => [node] }, budget);
}
async function compare(left: Value, right: Value, operator: Operator, budget: XmlBudget): Promise<boolean> {
  if (operator === "or") return boolean(left) || boolean(right);
  if (operator === "and") return boolean(left) && boolean(right);
  const equality = operator === "=" || operator === "!=";
  if (equality && (typeof left === "boolean" || typeof right === "boolean"))
    return operator === "=" ? boolean(left) === boolean(right) : boolean(left) !== boolean(right);
  const numeric = !equality || typeof left === "number" || typeof right === "number";
  for await (const a of comparisonValues(left, budget)) for await (const b of comparisonValues(right, budget)) {
    const p = budget.tick(String(a).length + String(b).length + 1); if (p) await p;
    const x = numeric ? await number(a, budget) : String(a), y = numeric ? await number(b, budget) : String(b);
    if (operator === "=" ? x === y : operator === "!=" ? x !== y : operator === "<" ? x < y : operator === "<=" ? x <= y : operator === ">" ? x > y : x >= y) return true;
  }
  return false;
}
function normalize(text: string): string {
  let result = "", pending = false;
  for (const c of text) {
    if (whitespace(c)) pending = result.length > 0;
    else { if (pending) result += " "; result += c; pending = false; }
  }
  return result;
}
export async function evaluateExpression(program: readonly Instruction[], node: Node, position: number, last: number, budget: XmlBudget, select?: Selector): Promise<Value> {
  const values: Value[] = [];
  for (const instruction of program) {
    const p = budget.tick(); if (p) await p;
    if (instruction.kind === "literal") values.push(instruction.value);
    else if (instruction.kind === "path") {
      if (!select) throw new XmlQueryError("absolute paths are unavailable in this context", 10);
      const selected = await select(instruction.query!, instruction.source.startsWith("/"));
      values.push(Array.isArray(selected) ? { size: selected.length, nodes: () => selected } : selected);
    } else if (instruction.kind === "negate") {
      values.push(-await number(values.pop()!, budget));
    } else if (instruction.kind === "operator") {
      const right = values.pop()!, left = values.pop()!;
      if (instruction.name === "+" || instruction.name === "-") {
        const a = await number(left, budget), b = await number(right, budget);
        values.push(instruction.name === "+" ? a + b : a - b);
      } else values.push(await compare(left, right, instruction.name, budget));
    } else {
      const args = values.splice(values.length - instruction.count);
      const first = args[0] ?? { size: 1, nodes: () => [node] };
      const textNeeded = !["count", "boolean", "not", "name", "local-name", "namespace-uri", "position", "last", "true", "false", "sum"].includes(instruction.name);
      const a = textNeeded ? await expressionString(first, budget) : "";
      const b = instruction.count > 1 ? await expressionString(args[1]!, budget) : "";
      { const p = budget.tick(a.length + b.length); if (p) await p; }
      const nodes = (): NodeSelection => {
        if (!isSelection(first)) throw new XmlQueryError("XPath function requires a node-set", 10);
        return first;
      };
      let result: Value;
      switch (instruction.name) {
        case "position": result = position; break;
        case "last": result = last; break;
        case "not": result = !boolean(first); break;
        case "boolean": result = boolean(first); break;
        case "true": result = true; break;
        case "false": result = false; break;
        case "string": result = a; break;
        case "number": result = await number(first, budget); break;
        case "count": result = nodes().size; break;
        case "sum": {
          let total = 0;
          for await (const item of comparisonValues(nodes(), budget)) total += await number(item, budget);
          result = total; break;
        }
        case "floor": result = Math.floor(await number(first, budget)); break;
        case "ceiling": result = Math.ceil(await number(first, budget)); break;
        case "round": result = Math.round(await number(first, budget)); break;
        case "contains": result = a.includes(b); break;
        case "starts-with": result = a.startsWith(b); break;
        case "normalize-space": result = normalize(a); break;
        case "concat": {
          let text = "", size = 0;
          for (const arg of args) {
            const part = await expressionString(arg, budget);
            size += new TextEncoder().encode(part).byteLength;
            if (size > budget.limits.maxOutputBytes) throw new XmlQueryError("maxOutputBytes limit exceeded", 5);
            text += part;
          }
          result = text; break;
        }
        case "string-length": { let size = 0; for (const ignored of a) size++; result = size; break; }
        case "substring": {
          const start = Math.round(await number(args[1]!, budget));
          const end = args.length === 3 ? start + Math.round(await number(args[2]!, budget)) : Infinity;
          let text = "", index = 0;
          for (const character of a) { index++; if (index >= start && index < end) text += character; }
          result = text;
          break;
        }
        case "substring-before": result = a.includes(b) ? a.slice(0, a.indexOf(b)) : ""; break;
        case "substring-after": result = a.includes(b) ? a.slice(a.indexOf(b) + b.length) : ""; break;
        case "translate": {
          const replacements = [...await expressionString(args[2]!, budget)], mapping = new Map<string, string>();
          let index = 0;
          for (const character of b) { if (!mapping.has(character)) mapping.set(character, replacements[index] ?? ""); index++; }
          let text = "";
          for (const character of a) text += mapping.get(character) ?? character;
          result = text; break;
        }
        case "name": case "local-name": case "namespace-uri": {
          let selected: Node | undefined;
          for await (const item of nodes().nodes()) { selected = item; break; }
          result = selected?.kind === "element" || selected?.kind === "attribute"
            ? instruction.name === "name" ? selected.value.name : instruction.name === "local-name" ? selected.value.localName : selected.value.namespace
            : selected?.kind === "processing-instruction" && instruction.name !== "namespace-uri" ? selected.value.kind === "processing-instruction" ? selected.value.target : "" : "";
          break;
        }
      }
      if (typeof result === "string") {
        if (new TextEncoder().encode(result).byteLength > budget.limits.maxOutputBytes) throw new XmlQueryError("maxOutputBytes limit exceeded", 5);
        const p = budget.tick(result.length); if (p) await p;
      }
      values.push(result);
    }
  }
  return values[0]!;
}
export async function testPredicate(program: readonly Instruction[], node: Node, position: number, last: number, budget: XmlBudget, select?: Selector): Promise<boolean> {
  const result = await evaluateExpression(program, node, position, last, budget, select);
  return typeof result === "number" ? result === position : boolean(result);
}
