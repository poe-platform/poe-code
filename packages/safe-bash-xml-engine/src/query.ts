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
  readonly scalar: "string" | "count" | "boolean" | undefined;
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
  let scalar: Query["scalar"];
  if (
    ["string", "count", "boolean"].some(
      (value) =>
        source.startsWith(value, at) &&
        (() => {
          let offset = at + value.length;
          while (" \t\r\n".includes(source[offset] ?? "") && offset < source.length) offset++;
          return source[offset] === "(";
        })()
    )
  ) {
    const value = name();
    if (value !== "string" && value !== "count" && value !== "boolean") fail();
    scalar = value as Query["scalar"];
    expect("(");
  }
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
        let quote = "";
        while (at < source.length) {
          const character = source[at]!;
          if (quote) { if (character === quote) quote = ""; }
          else if (character === "'" || character === '"') quote = character;
          else if (character === "]") break;
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
  if (scalar !== undefined) expect(")");
  space();
  if (at !== source.length) fail();
  return { scalar, paths };
}
