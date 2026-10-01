import { XmlBudget, XmlQueryError, XmlQueryLimitError } from "./limits.js";

import { parsePredicate, type Instruction } from "./predicate.js";

export type Predicate = readonly Instruction[];
export interface QueryStep {
  readonly descendant: boolean;
  readonly kind: "element" | "attribute" | "text" | "self" | "parent";
  readonly name: string;
  readonly predicates: readonly Predicate[];
}
export interface Query {
  readonly expression?: readonly Instruction[];
  readonly paths: readonly (readonly QueryStep[])[];
}
const nameStart = (character: string): boolean =>
  (character >= "a" && character <= "z") ||
  (character >= "A" && character <= "Z") ||
  character === "_";
const namePart = (character: string): boolean =>
  nameStart(character) ||
  (character >= "0" && character <= "9") ||
  character === "-" ||
  character === ".";

export async function parseQuery(source: string, budget: XmlBudget): Promise<Query> {
  const query = await parseSyntax(source, budget);
  const pending = [{ query, depth: 0 }];
  while (pending.length) {
    const current = pending.pop()!;
    const programs = current.query.expression ? [current.query.expression] :
      current.query.paths.flatMap(path => path.flatMap(step => step.predicates));
    for (const program of programs) for (const instruction of program) {
      if (instruction.kind !== "path") continue;
      if (current.depth >= budget.limits.maxDepth) throw new XmlQueryLimitError("maxDepth");
      instruction.query = await parseSyntax(instruction.source, budget);
      pending.push({ query: instruction.query, depth: current.depth + 1 });
    }
  }
  return query;
}

async function parseSyntax(source: string, budget: XmlBudget): Promise<Query> {
  if (
    source.length > budget.limits.maxSourceBytes ||
    new TextEncoder().encode(source).byteLength > budget.limits.maxSourceBytes
  )
    throw new XmlQueryLimitError("maxSourceBytes");
  // Admit every character before token operations; the grammar itself has no recursion.
  for (let offset = 0; offset < source.length; offset += 256)
    await budget.tick(Math.min(256, source.length - offset));
  let at = 0;
  const fail = (): never => {
    throw new XmlQueryError(`unsupported XPath syntax at offset ${at}`, 10);
  };
  const space = (): void => {
    while (source[at] === " " || source[at] === "\t" || source[at] === "\r" || source[at] === "\n")
      at++;
  };
  const expect = (value: string): void => {
    space();
    if (!source.startsWith(value, at)) fail();
    at += value.length;
  };
  const name = (): string => {
    space();
    const start = at;
    if (!nameStart(source[at] ?? "")) fail();
    while (namePart(source[at] ?? "")) at++;
    if (source[at] === ":") fail();
    return source.slice(start, at);
  };
  space();
  const start = at;
  if (nameStart(source[at] ?? "")) {
    while (namePart(source[at] ?? "")) at++;
    const selected = source.slice(start, at);
    space();
    if (source[at] === "(" && selected !== "text")
      return { paths: [], expression: parsePredicate(source, budget) };
  }
  at = start;
  const paths: QueryStep[][] = [];
  let morePaths: boolean;
  do {
    const steps: QueryStep[] = [];
    paths.push(steps);
    space();
    do {
      let descendant = false;
      if (source[at] === "/") {
        at++;
        descendant = source[at] === "/";
        if (descendant) at++;
      }
      space();
      let kind: QueryStep["kind"] = "element";
      if (source[at] === "@") {
        kind = "attribute";
        at++;
      }
      let selected: string;
      if (source[at] === ".") {
        at++;
        selected = ".";
        kind = source[at] === "." ? "parent" : "self";
        if (kind === "parent") at++;
      } else if (source[at] === "*") {
        selected = "*";
        at++;
      } else {
        selected = name();
        space();
        if (source[at] === "(") {
          if (selected !== "text" || kind !== "element") fail();
          expect("(");
          expect(")");
          kind = "text";
        }
      }
      const predicates: Predicate[] = [];
      space();
      while (source[at] === "[") {
        at++;
        space();
        const start = at;
        let quote = "", depth = 0;
        while (at < source.length) {
          const character = source[at]!;
          if (quote) { if (character === quote) quote = ""; }
          else if (character === "'" || character === '"') quote = character;
          else if (character === "[") depth++;
          else if (character === "]") { if (depth === 0) break; depth--; }
          at++;
        }
        if (at === source.length) fail();
        predicates.push(parsePredicate(source.slice(start, at), budget));
        expect("]");
        space();
      }
      steps.push({ descendant, kind, name: selected, predicates });
      if ((kind === "attribute" || kind === "text") && source[at] === "/") fail();
      { const _p = budget.tick(); if (_p) await _p; }
    } while (source[at] === "/");
    space();
    morePaths = source[at] === "|";
    if (morePaths) at++;
  } while (morePaths);
  space();
  if (at !== source.length) fail();
  return { paths };
}
