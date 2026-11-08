import { expect, it } from "vitest";
import { parseSourceModule } from "./source-module.js";
import { tokenize } from "./tokenizer.js";
import { Budget } from "../interp/budget.js";

it("preserves public tokenizer boundary identity and mutation", () => {
  const tokens = tokenize("a+b");
  expect(tokens[0]!.end).not.toBe(tokens[1]!.start);
  expect(Object.isFrozen(tokens[0]!.end)).toBe(false);
  tokens[0]!.end.column = -1;
  expect(tokens[1]!.start.column).toBe(2);
});

it("shares immutable adjacent positions only when selected", () => {
  const tokens = tokenize("a+b", { sharedPositions: true });
  expect(tokens[0]!.end).toBe(tokens[1]!.start);
  expect(tokens[1]!.end).toBe(tokens[2]!.start);
  expect(tokens[2]!.end).toBe(tokens[3]!.start);
  expect(Object.isFrozen(tokens[0]!.end)).toBe(true);
  expect(() => {
    tokens[0]!.end.column = -1;
  }).toThrow(TypeError);
  expect(tokens[1]!.start.column).toBe(2);
});

it.each([
  "const a=1;export{a};",
  "/* before */\r\nexport const astral='😀';\u2028// comment\u2029export const result=`a${astral}b`;",
  "export const regex=/a[b-c]+/g;\nexport const division=6/2;",
  "export const result=await Promise.resolve(42);",
  "import {x as y} from './dep.js';export const second=2;const first=1;export {first};export {default as other} from './other.js';function later(){\"use strict\";return y+first;}class Example{method(){return later();}}",
  "export {};;let first=1\nfirst++\nconst arrow=(x)=>x+first;export {arrow};"
])("preserves complete token and module positions for %j", (source) => {
  expect(
    tokenize(source, {
      allowRegexLiterals: true,
      statementList: true,
      sharedPositions: true
    })
  ).toEqual(tokenize(source, { allowRegexLiterals: true, statementList: true }));
  const normal = parseSourceModule(source);
  const shared = parseSourceModule(source, "<input>", undefined, {
    sharedPositions: true
  });
  expect(shared).toEqual(normal);
  expect(Object.isFrozen(normal.module.body[0]!.span.start)).toBe(false);
  expect(Object.isFrozen(shared.module.body[0]!.span.start)).toBe(true);
});

it.each([
  "export const = 1;",
  "export const value=`bad${;}`;",
  "export const value='a';\nimport {x} from ;",
  "export const first=1;export const first=2;",
  "import {x} from './dep.js';export {missing};"
])("preserves syntax diagnostics for %j", (source) => {
  let normal: unknown, shared: unknown;
  try {
    parseSourceModule(source, "fixture.js");
  } catch (error) {
    normal = error;
  }
  try {
    parseSourceModule(source, "fixture.js", undefined, {
      sharedPositions: true
    });
  } catch (error) {
    shared = error;
  }
  expect(normal).toBeInstanceOf(SyntaxError);
  expect(shared).toBeInstanceOf(SyntaxError);
  expect(shared).toMatchObject({ message: (normal as Error).message });
  expect(Object.getOwnPropertyNames(shared)).toEqual(Object.getOwnPropertyNames(normal));
  for (const name of Object.getOwnPropertyNames(normal)) {
    if (name !== "stack")
      expect(Reflect.get(shared as object, name)).toEqual(Reflect.get(normal as object, name));
  }
});

it("reduces distinct retained positions without changing AST data", () => {
  const source = "export const value=" + Array.from({ length: 200 }, (_, i) => i).join("+") + ";";
  const normal = parseSourceModule(source);
  const shared = parseSourceModule(source, "<input>", undefined, { sharedPositions: true });
  const positions = (root: unknown) => {
    const retained = new Set<object>();
    const seen = new Set<object>();
    const pending = [root];
    while (pending.length > 0) {
      const value = pending.pop();
      if (value === null || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      if ("offset" in value && "line" in value && "column" in value) retained.add(value);
      pending.push(...Object.values(value));
    }
    return retained.size;
  };
  expect(shared).toEqual(normal);
  expect(positions(shared)).toBeLessThan(positions(normal) * 0.75);
});

it.each([
  "export const value=/a[b-c]+/g;",
  "export const value=await Promise.resolve(42);",
  "import {value} from 'dep';export {value};"
])("preserves compiler charges and releases for %j", (source) => {
  const compile = (sharedPositions: boolean) => {
    const budget = new Budget();
    const lease = budget.acquireCompileOwner();
    try {
      const parsed = parseSourceModule(source, "entry", lease.owner, { sharedPositions });
      return { parsed, steps: budget.stepsUsed, data: budget.currentDataSize };
    } finally {
      lease.release();
      expect(budget.currentDataSize).toBe(0);
    }
  };
  expect(compile(true)).toEqual(compile(false));
});

it.each([{ stringLength: 10 }, { maxSteps: 20 }, { regexCompileAllocations: 1 }])(
  "preserves compiler rejection and cleanup for %j",
  (limits) => {
    const compile = (sharedPositions: boolean) => {
      const budget = new Budget(limits);
      const lease = budget.acquireCompileOwner();
      try {
        expect(() =>
          parseSourceModule("export const value=/a[b-c]+/g;", "entry", lease.owner, {
            sharedPositions
          })
        ).toThrow();
        return { steps: budget.stepsUsed, data: budget.currentDataSize };
      } finally {
        lease.release();
        expect(budget.currentDataSize).toBe(0);
      }
    };
    expect(compile(true)).toEqual(compile(false));
  }
);
