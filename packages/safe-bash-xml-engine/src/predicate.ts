import { XmlBudget, XmlQueryError } from "./limits.js";
import { stringValue, type Node } from "./evaluate.js";

type Value = string | number | boolean | readonly string[];
type Operator = "or" | "and" | "=" | "!=" | "<" | "<=" | ">" | ">=";
type FunctionName = "contains" | "starts-with" | "normalize-space" | "not" | "position" | "last";
export type Instruction =
  | { kind: "literal"; value: string | number }
  | { kind: "nodes"; axis: "attribute" | "child" | "text" | "self"; name: string }
  | { kind: "operator"; name: Operator }
  | { kind: "function"; name: FunctionName; count: number };
const precedence: Record<Operator, number> = { or: 1, and: 2, "=": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3 };
const arity: Record<FunctionName, readonly number[]> = { contains: [2], "starts-with": [2], "normalize-space": [0, 1], not: [1], position: [0], last: [0] };
const whitespace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r";
const digit = (c: string): boolean => c >= "0" && c <= "9";
const nameStart = (c: string): boolean => c >= "a" && c <= "z" || c >= "A" && c <= "Z" || c === "_";
const namePart = (c: string): boolean => nameStart(c) || digit(c) || c === "-" || c === ".";

/** Shunting-yard compilation keeps adversarial expression nesting off the JS stack. */
export function parsePredicate(source: string, budget: XmlBudget): readonly Instruction[] {
  const output: Instruction[] = [];
  const stack: ({ kind: "operator"; name: Operator } | { kind: "group"; name?: FunctionName; commas: number })[] = [];
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
    while (stack.at(-1)?.kind === "operator") output.push(stack.pop()! as Instruction);
  };
  while (true) {
    space();
    if (at === source.length) break;
    const c = source[at]!;
    if (c === ")") {
      flush();
      const group = stack.pop();
      if (!group || group.kind !== "group") return fail();
      if (expecting && (group.commas > 0 || group.name === undefined)) fail();
      const count = expecting ? 0 : group.commas + 1;
      if (group.name !== undefined) {
        if (!arity[group.name].includes(count)) fail();
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
      if (c === "=" || c === "!" || c === "<" || c === ">") {
        operator = c; at++;
        if (source[at] === "=") { operator += "="; at++; }
      } else operator = name();
      if (!Object.hasOwn(precedence, operator)) fail();
      const selected = operator as Operator;
      while (stack.at(-1)?.kind === "operator") {
        const top = stack.at(-1)! as { kind: "operator"; name: Operator };
        if (precedence[top.name] < precedence[selected]) break;
        output.push(stack.pop()! as Instruction);
      }
      stack.push({ kind: "operator", name: selected }); expecting = true; continue;
    }
    if (c === "(") { stack.push({ kind: "group", commas: 0 }); depth++; at++; }
    else if (c === "'" || c === '"') {
      const start = ++at;
      while (at < source.length && source[at] !== c) at++;
      if (at === source.length) fail();
      output.push({ kind: "literal", value: source.slice(start, at++) }); expecting = false;
    } else if (digit(c) || c === "-" || c === "." && digit(source[at + 1] ?? "")) {
      const start = at;
      if (c === "-") at++;
      let digits = 0;
      while (digit(source[at] ?? "")) { at++; digits++; }
      if (source[at] === ".") { at++; while (digit(source[at] ?? "")) { at++; digits++; } }
      if (!digits) fail();
      output.push({ kind: "literal", value: Number(source.slice(start, at)) }); expecting = false;
    } else if (c === "@" || c === ".") {
      at++;
      output.push({ kind: "nodes", axis: c === "@" ? "attribute" : "self", name: c === "@" ? name() : "" }); expecting = false;
    } else {
      const selected = name(); space();
      if (source[at] === "(") {
        at++; space();
        if (selected === "text") {
          if (source[at++] !== ")") fail();
          output.push({ kind: "nodes", axis: "text", name: "" }); expecting = false;
        } else {
          if (!Object.hasOwn(arity, selected)) fail();
          stack.push({ kind: "group", name: selected as FunctionName, commas: 0 }); depth++;
        }
      } else { output.push({ kind: "nodes", axis: "child", name: selected }); expecting = false; }
    }
    if (depth > budget.limits.maxDepth)
      throw new XmlQueryError("maxDepth limit exceeded", 5);
  }
  if (expecting) fail();
  flush();
  if (stack.length) fail();
  return output;
}
const boolean = (value: Value): boolean => Array.isArray(value) ? value.length > 0 : typeof value === "number" ? value !== 0 && !Number.isNaN(value) : Boolean(value);
const string = (value: Value): string => Array.isArray(value) ? value[0] ?? "" : String(value);
const number = (value: Value): number => {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = string(value).trim();
  if (!text || [...text].some(c => !digit(c) && c !== "." && c !== "-")) return NaN;
  return Number(text);
};
async function compare(left: Value, right: Value, operator: Operator, budget: XmlBudget): Promise<boolean> {
  if (operator === "or") return boolean(left) || boolean(right);
  if (operator === "and") return boolean(left) && boolean(right);
  const equality = operator === "=" || operator === "!=";
  if (equality && (typeof left === "boolean" || typeof right === "boolean"))
    return operator === "=" ? boolean(left) === boolean(right) : boolean(left) !== boolean(right);
  const numeric = !equality || typeof left === "number" || typeof right === "number";
  for (const a of Array.isArray(left) ? left : [left]) for (const b of Array.isArray(right) ? right : [right]) {
    const p = budget.tick(string(a).length + string(b).length + 1); if (p) await p;
    const x = numeric ? number(a) : string(a), y = numeric ? number(b) : string(b);
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
export async function testPredicate(program: readonly Instruction[], node: Node, position: number, last: number, budget: XmlBudget): Promise<boolean> {
  const values: Value[] = [];
  const text = async (selected: Node | undefined): Promise<string> => {
    let value = "";
    for await (const part of stringValue(selected, budget)) { const p = budget.tick(part.length); if (p) await p; value += part; }
    return value;
  };
  for (const instruction of program) {
    const p = budget.tick(); if (p) await p;
    if (instruction.kind === "literal") values.push(instruction.value);
    else if (instruction.kind === "nodes") {
      const selected: string[] = [];
      if (instruction.axis === "self") selected.push(await text(node));
      else if (node.kind === "element" || node.kind === "document") {
        for (const child of instruction.axis === "attribute" ? node.kind === "element" ? node.attributes : [] : node.children) {
          const p = budget.tick(); if (p) await p;
          if (instruction.axis === "text" ? child.kind === "text" || child.kind === "cdata" : (child.kind === "element" || child.kind === "attribute") && child.value.namespace === "" && child.value.localName === instruction.name)
            selected.push(await text(child));
        }
      }
      values.push(selected);
    } else if (instruction.kind === "operator") {
      const right = values.pop()!, left = values.pop()!;
      values.push(await compare(left, right, instruction.name, budget));
    } else {
      const args = values.splice(values.length - instruction.count);
      const a = instruction.count ? string(args[0]!) : instruction.name === "normalize-space" ? await text(node) : "";
      const b = instruction.count > 1 ? string(args[1]!) : "";
      const p = budget.tick(a.length + b.length); if (p) await p;
      switch (instruction.name) {
        case "position": values.push(position); break;
        case "last": values.push(last); break;
        case "not": values.push(!boolean(args[0]!)); break;
        case "contains": values.push(a.includes(b)); break;
        case "starts-with": values.push(a.startsWith(b)); break;
        case "normalize-space": values.push(normalize(a)); break;
      }
    }
  }
  const result = values[0]!;
  return typeof result === "number" ? result === position : boolean(result);
}
