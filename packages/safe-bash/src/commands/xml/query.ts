import { XmlBudget, XmlQueryError, XmlQueryLimitError } from "./limits.js";

export type Predicate = { kind: "position"; value: number } | { kind: "last" }
  | { kind: "attribute"; name: string; value?: string }
  | { kind: "child" | "text" | "self"; name: string; value: string };
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
  if (["string", "count", "boolean"].some(value => source.startsWith(value, at) && (() => { let offset = at + value.length; while (" \t\r\n".includes(source[offset] ?? "") && offset < source.length) offset++; return source[offset] === "("; })())) {
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
      if (source[at] === "@") { kind = "attribute"; at++; }
      let selected: string;
      if (source[at] === ".") {
        at++; selected = ".";
        kind = source[at] === "." ? "parent" : "self";
        if (kind === "parent") at++;
      } else if (source[at] === "*") { selected = "*"; at++; }
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
        const integer = (): number => {
          const start = at;
          while ((source[at] ?? "") >= "0" && (source[at] ?? "") <= "9") at++;
          const value = Number(source.slice(start, at));
          if (start === at || !Number.isSafeInteger(value) || value < 1) fail();
          return value;
        };
        if ((source[at] ?? "") >= "0" && (source[at] ?? "") <= "9") {
          predicates.push({ kind: "position", value: integer() });
        } else if (["last", "position"].some(value => source.startsWith(value, at) && (() => { let offset = at + value.length; while (offset < source.length && " \t\r\n".includes(source[offset]!)) offset++; return source[offset] === "("; })())) {
          const functionName = name(); expect("("); expect(")");
          if (functionName === "last") predicates.push({ kind: "last" });
          else if (functionName === "position") { expect("="); space(); predicates.push({ kind: "position", value: integer() }); }
          else fail();
        } else {
          let predicateKind: "attribute" | "child" | "text" | "self" = "child";
          let selectedName = "";
          if (source[at] === "@") { at++; predicateKind = "attribute"; selectedName = name(); }
          else if (source[at] === ".") { at++; predicateKind = "self"; }
          else {
            selectedName = name(); space();
            if (source[at] === "(") {
              if (selectedName !== "text") fail();
              expect("("); expect(")"); predicateKind = "text";
            }
          }
          space();
          if (predicateKind === "attribute" && source[at] === "]") {
            predicates.push({ kind: "attribute", name: selectedName });
          } else {
            expect("="); space();
            const quote = source[at++];
            if (quote !== "'" && quote !== '"') fail();
            const start = at;
            while (at < source.length && source[at] !== quote) at++;
            if (at === source.length) fail();
            predicates.push({ kind: predicateKind, name: selectedName, value: source.slice(start, at++) });
          }
        }
        expect("]"); space();
      }
      steps.push({ descendant, kind, name: selected, predicates });
      if ((kind === "attribute" || kind === "text") && source[at] === "/") fail();
      await budget.tick();
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
