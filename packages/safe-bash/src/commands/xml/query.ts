import { XmlBudget, XmlQueryError, XmlQueryLimitError } from "./limits.js";

export type Predicate = { kind: "position"; value: number } | { kind: "attribute"; name: string; value: string };
export interface QueryStep {
  readonly descendant: boolean;
  readonly kind: "element" | "attribute" | "text";
  readonly name: string;
  readonly predicates: readonly Predicate[];
}
export interface Query {
  readonly scalar: "string" | "count" | "boolean" | undefined;
  readonly steps: readonly QueryStep[];
}
const nameStart = (character: string): boolean => character >= "a" && character <= "z" || character >= "A" && character <= "Z" || character === "_";
const namePart = (character: string): boolean => nameStart(character) || character >= "0" && character <= "9" || character === "-" || character === ".";

export async function parseQuery(source: string, budget: XmlBudget): Promise<Query> {
  if (source.length > budget.limits.maxSourceBytes || Buffer.byteLength(source) > budget.limits.maxSourceBytes) throw new XmlQueryLimitError("maxSourceBytes");
  // Admit every character before token operations; the grammar itself has no recursion.
  for (let offset = 0; offset < source.length; offset += 256) await budget.tick(Math.min(256, source.length - offset));
  let at = 0;
  const fail = (): never => { throw new XmlQueryError(`unsupported XPath syntax at offset ${at}`, 10); };
  const space = (): void => { while (source[at] === " " || source[at] === "\t" || source[at] === "\r" || source[at] === "\n") at++; };
  const expect = (value: string): void => { space(); if (!source.startsWith(value, at)) fail(); at += value.length; };
  const name = (): string => {
    space(); const start = at;
    if (!nameStart(source[at] ?? "")) fail();
    while (namePart(source[at] ?? "")) at++;
    if (source[at] === ":") fail();
    return source.slice(start, at);
  };
  space();
  let scalar: Query["scalar"];
  if (source[at] !== "/") {
    const value = name();
    if (value !== "string" && value !== "count" && value !== "boolean") fail();
    scalar = value as Query["scalar"];
    expect("(");
  }
  const steps: QueryStep[] = [];
  space();
  while (source[at] === "/") {
    at++;
    const descendant = source[at] === "/";
    if (descendant) at++;
    space();
    let kind: QueryStep["kind"] = "element";
    if (source[at] === "@") { kind = "attribute"; at++; }
    let selected: string;
    if (source[at] === "*") { selected = "*"; at++; }
    else {
      selected = name();
      space();
      if (source[at] === "(") {
        if (selected !== "text" || kind !== "element") fail();
        expect("("); expect(")"); kind = "text";
      }
    }
    const predicates: Predicate[] = [];
    space();
    while (source[at] === "[") {
      at++; space();
      if (source[at] === "@") {
        at++; const attribute = name(); expect("="); space();
        const quote = source[at++];
        if (quote !== "'" && quote !== '"') fail();
        const start = at;
        while (at < source.length && source[at] !== quote) at++;
        if (at === source.length) fail();
        predicates.push({ kind: "attribute", name: attribute, value: source.slice(start, at++) });
      } else {
        const start = at;
        while ((source[at] ?? "") >= "0" && (source[at] ?? "") <= "9") at++;
        const value = Number(source.slice(start, at));
        if (start === at || !Number.isSafeInteger(value) || value < 1) fail();
        predicates.push({ kind: "position", value });
      }
      expect("]"); space();
    }
    steps.push({ descendant, kind, name: selected, predicates });
    if (kind !== "element" && source[at] === "/") fail();
    await budget.tick();
  }
  if (!steps.length) fail();
  if (scalar !== undefined) expect(")");
  space();
  if (at !== source.length) fail();
  return { scalar, steps };
}
