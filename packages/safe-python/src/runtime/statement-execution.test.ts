import { describe, expect, it } from "vitest";
import { parseModule } from "../module.js";
import type { Expression,SourceSpan } from "../ast.js";
import type { Statement } from "../statement-ast.js";
import { ExecutionBudget,ExecutionLimitError } from "./execution-budget.js";
import { executeStatements, type StatementContext } from "./statement-execution.js";

function fixture(inputs: Record<string, unknown> = {}) {
  const names = new Map(Object.entries(inputs)), events: unknown[] = [];
  const evaluate = (expression: Expression): unknown => {
    if (expression.kind === "literal") return typeof expression.value === "bigint" ? Number(expression.value) : expression.value;
    if (expression.kind === "name") {
      const value = names.get(expression.name);
      return typeof value === "function" ? value() : value;
    }
    throw new Error("unsupported fixture expression");
  };
  const context: StatementContext<unknown> = {
    evaluate,
    test: expression => Boolean(evaluate(expression)),
    iterate: value => (value as Iterable<unknown>)[Symbol.iterator](),
    assign: (target, value) => {
      if (target.kind !== "name") throw new Error("unsupported fixture target");
      names.set(target.name, value);
    },
    execute: statement => {
      if (statement.kind !== "expression-statement") throw new Error("unsupported fixture statement");
      events.push(evaluate(statement.expression));
    }
  };
  return { context, names, events };
}
const budget = (maxSteps = 100000) => new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 });

it("preserves null guest payloads returned by native fault preparation",()=>{
  const fault=Error("native"),seen:unknown[]=[];
  const state=fixture({fail:()=>{throw fault;}});
  state.context.exceptions={prepare:error=>{expect(error).toBe(fault);return null;},isGuest:error=>error===null,
    enter:error=>{seen.push(error);return ()=>seen.push("restore");},
    handlers:{match:()=>true,bind:()=>{},clear:()=>{}}
  };
  executeStatements(parseModule("try:\n fail\nexcept:\n 42\n").body,state.context,budget());
  expect(state.events).toEqual([42]);expect(seen).toEqual([null,"restore"]);
});

describe("statement control flow", () => {
  it("records bare return and only executed suites",()=>{
    const state=fixture(),lines:number[]=[];state.context.position=site=>{lines.push(site.start.line);};
    expect(executeStatements(parseModule("if False:\n 1\nelse:\n pass\n return\n 2").body,state.context,budget())).toEqual({kind:"return"});
    expect(lines).toEqual([1,1,4,5]);
  });

  it.each([false,true])("checks cancellation after position callbacks (throws=%s)",throws=>{
    const state=fixture(),controller=new AbortController();state.context.position=()=>{controller.abort();if(throws)throw Error("position");};
    expect(()=>executeStatements(parseModule("1").body,state.context,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000,signal:controller.signal}))).toThrow(ExecutionLimitError);
    expect(state.events).toEqual([]);
  });

  it("preserves ordinary position failures before statement side effects",()=>{
    const state=fixture(),failure=Error("position");state.context.position=()=>{throw failure;};
    expect(()=>executeStatements(parseModule("1").body,state.context,budget())).toThrow(failure);expect(state.events).toEqual([]);
  });
  it("restores iterable and assignment sites on every loop advance",()=>{
    const state=fixture({items:[1,2]}),sites:string[]=[];let current:SourceSpan|undefined;
    state.context.position=node=>{current=node;};
    state.context.iterate=()=>{sites.push(`iter:${current?.start.line}`);let index=0;return {next(){sites.push(`next:${current?.start.line}`);return index++<2?{done:false,value:index}:{done:true,value:undefined};}};};
    const assign=state.context.assign;state.context.assign=(node,value)=>{sites.push(`assign:${current?.start.line}`);assign(node,value);};
    executeStatements(parseModule("for x in (\n items\n):\n 1").body,state.context,budget());
    expect(sites).toEqual(["iter:2","next:2","assign:1","next:2","assign:1","next:2"]);
  });

  it("retains each multiline manager site for reverse cleanup",()=>{
    const state=fixture({a:"a",b:"b"}),sites:string[]=[];let current:SourceSpan|undefined;
    state.context.position=node=>{current=node;};
    state.context.managers={prepare(value){sites.push(`prepare:${value}:${current?.start.line}`);return {enter(){sites.push(`enter:${value}:${current?.start.line}`);return value;},exit(){sites.push(`exit:${value}:${current?.start.line}`);return false;}};},truth:Boolean};
    executeStatements(parseModule("with (\n a,\n b\n):\n 1").body,state.context,budget());
    expect(sites).toEqual(["prepare:a:2","enter:a:2","prepare:b:3","enter:b:3","exit:b:3","exit:a:2"]);
  });
  it("executes only the first selected conditional suite", () => {
    const state = fixture({ a: false, b: true, never: () => { throw new Error("unreachable"); } });
    expect(executeStatements(parseModule("0\nif a:\n  1\nelif b:\n  2\nelif never:\n  3\nelse:\n  4\n5").body, state.context, budget())).toEqual({ kind: "normal" });
    expect(state.events).toEqual([0, 2, 5]);
  });

  it("retests while conditions and executes else after normal exhaustion", () => {
    let remaining = 3;
    const state = fixture({ again: () => remaining-- > 0 });
    executeStatements(parseModule("while again:\n  1\n  continue\n  99\nelse:\n  2\n3").body, state.context, budget());
    expect(state.events).toEqual([1, 1, 1, 2, 3]);
    expect(remaining).toBe(-1);
  });

  it("skips while else after break", () => {
    const state = fixture();
    executeStatements(parseModule("while True:\n  1\n  break\n  99\nelse:\n  98\n2").body, state.context, budget());
    expect(state.events).toEqual([1, 2]);
  });

  it("evaluates a for iterable once and leaves its last target binding", () => {
    let calls = 0;
    const state = fixture({ items: () => { calls++; return [1, 2, 3]; } });
    executeStatements(parseModule("for x in items:\n  x\n  continue\n  99\nelse:\n  4\nx").body, state.context, budget());
    expect(state.events).toEqual([1, 2, 3, 4, 3]);
    expect(calls).toBe(1);
  });

  it("does not assign an empty iterator's target", () => {
    const state = fixture({ items: [], x: 9 });
    executeStatements(parseModule("for x in items:\n  99\nelse:\n  x").body, state.context, budget());
    expect(state.events).toEqual([9]);
  });

  it("binds break in an inner loop else to the outer loop", () => {
    const state = fixture({ items: [1, 2], empty: [] });
    executeStatements(parseModule("for x in items:\n  for y in empty:\n    99\n  else:\n    x\n    break\n  98\nelse:\n  97\n3").body, state.context, budget());
    expect(state.events).toEqual([1, 3]);
  });

  it("binds continue in an inner loop else to the outer loop", () => {
    const state = fixture({ items: [1, 2], empty: [] });
    executeStatements(parseModule("for x in items:\n  for y in empty:\n    99\n  else:\n    x\n    continue\n  98\nelse:\n  3").body, state.context, budget());
    expect(state.events).toEqual([1, 2, 3]);
  });

  it.each(["break", "return x"])("does not close a for iterator on %s", transfer => {
    let nexts = 0, closes = 0;
    const iterator = { next: () => ({ done: false, value: ++nexts }), return: () => { closes++; return { done: true, value: 0 }; }, [Symbol.iterator]() { return this; } };
    const state = fixture({ items: iterator });
    const result = executeStatements(parseModule(`for x in items:\n  ${transfer}\nelse:\n  99`).body, state.context, budget());
    expect(result).toEqual(transfer === "break" ? { kind: "normal" } : { kind: "return", value: 1 });
    expect([nexts, closes]).toEqual([1, 0]);
    expect(state.events).toEqual([]);
  });

  it("distinguishes a bare return from a returned undefined host payload", () => {
    const state = fixture();
    expect(executeStatements(parseModule("return\n99").body, state.context, budget())).toEqual({ kind: "return" });
    expect(executeStatements(parseModule("return missing\n99").body, state.context, budget())).toEqual({ kind: "return", value: undefined });
    expect(state.events).toEqual([]);
  });

  it("does not execute loop else after iterator or target-assignment errors", () => {
    for (const stage of ["next", "assign"]) {
      const state = fixture({ items: [1] });
      if (stage === "next") state.context.iterate = () => ({ next: () => { throw new Error(stage); } });
      else state.context.assign = () => { throw new Error(stage); };
      expect(() => executeStatements(parseModule("for x in items:\n  1\nelse:\n  2").body, state.context, budget())).toThrow(stage);
      expect(state.events).toEqual([]);
    }
  });

  it("bounds infinite loops, including empty bodies", () => {
    const state = fixture();
    expect(() => executeStatements(parseModule("while True:\n  pass").body, state.context, budget(20))).toThrow("execution step limit exceeded");
  });

  it("executes deeply nested blocks without host recursion", () => {
    const leaf = parseModule("1").body[0], condition = parseModule("if True:\n  pass").body[0];
    if (condition.kind !== "if") throw new Error("invalid fixture");
    let body: readonly Statement[] = [leaf];
    for (let i = 0; i < 10000; i++) body = [{ ...condition, branches: [{ condition: condition.branches[0].condition, body }] }];
    const state = fixture();
    executeStatements(body, state.context, budget());
    expect(state.events).toEqual([1]);
  });

  it.each(["try:\n  pass\nexcept:\n  pass", "with cm:\n  pass", "async for x in items:\n  pass", "match x:\n  case _:\n    pass"])("rejects unimplemented compound statements without guest effects: %s", source => {
    const state = fixture({ items: () => { throw new Error("must not evaluate"); } });
    expect(() => executeStatements(parseModule(source).body, state.context, budget())).toThrow("unsupported statement");
    expect(state.events).toEqual([]);
  });
});
