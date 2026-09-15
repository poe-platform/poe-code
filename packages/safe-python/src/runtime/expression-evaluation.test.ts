import { describe, expect, it } from "vitest";
import { parseExpression } from "../expression.js";
import type { Expression } from "../ast.js";
import { createExpressionContinuation,evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { ExecutionBudget,ExecutionLimitError } from "./execution-budget.js";
import { integerDivmod } from "./integer-arithmetic.js";
import { parseModule } from "../module.js";
import { executeStatements } from "./statement-execution.js";

type Value = bigint | boolean | null | string;

function environment(initial: ReadonlyMap<string, Value> = new Map()) {
  const names = new Map(initial), events: string[] = [];
  const context: ExpressionContext<Value> = {
    literal: node => {
      if (node.literalKind === "integer" || node.literalKind === "boolean" || node.literalKind === "none") return node.value as Value;
      throw new Error("fixture literal unsupported");
    },
    load: name => { events.push(`load:${name}`); if (!names.has(name)) throw new Error(`missing:${name}`); return names.get(name)!; },
    store: (name, value) => { events.push(`store:${name}`); names.set(name, value); },
    unary: (operator, value) => operator === "not" ? !context.truth(value) : operator === "-" ? -(value as bigint) : operator === "~" ? ~(value as bigint) : value,
    binary: (operator, left, right) => {
      events.push(`binary:${operator}`);
      if (operator === "+") return (left as bigint) + (right as bigint);
      if (operator === "*") return (left as bigint) * (right as bigint);
      if (operator === "//") return integerDivmod(left as bigint, right as bigint).quotient;
      throw new Error("fixture binary unsupported");
    },
    compare: (operator, left, right) => { events.push(`compare:${operator}`); return operator === "<" ? (left as bigint) < (right as bigint) : left === right; },
    truth: value => { events.push("truth"); return Boolean(value); },
    boolean: value => value,
    beginCall: () => { throw new Error("fixture calls unsupported"); },
    beginSet: () => { throw new Error("fixture sets unsupported"); },
    beginDictionary: () => { throw new Error("fixture dictionaries unsupported"); },
    tuple: () => { throw new Error("fixture tuples unsupported"); },
    list: () => { throw new Error("fixture lists unsupported"); },
    slice: () => { throw new Error("fixture slices unsupported"); },
    getItem: () => { throw new Error("fixture subscriptions unsupported"); },
    iterate: () => { throw new Error("fixture iteration unsupported"); },
    attribute: (value, name) => { events.push(`attribute:${name}`); return `${value}.${name}`; }
  };
  return { context, names, events };
}

const budget = () => new ExecutionBudget({ maxSteps: 1000000, maxAllocatedBytes: 1000000 });

describe("resumable expression execution",()=>{
  it("restores call ownership for argument collection and invocation",()=>{
    const {context}=environment(new Map<string,Value>([["f",0n],["a",1n],["b",2n]])),expression=parseExpression("f(\n a,\n key=b\n)"),seen:Expression[]=[];
    let current:Expression|undefined;context.position=node=>{current=node;};
    context.beginCall=()=>({positional(){seen.push(current!);},keywords(){seen.push(current!);},starred(){throw Error("unexpected star");},mapping(){throw Error("unexpected mapping");},invoke(){seen.push(current!);return 9n;}});
    expect(evaluateExpression(expression,context,budget())).toBe(9n);
    expect(seen).toEqual([expression,expression,expression]);
  });

  it.each(["(a +\n b)","(a *\n b)","-(\n a)","(a <\n b)","(a\n).x"])("retains the failing operation owner for %s",source=>{
    const {context}=environment(new Map<string,Value>([["a",1n],["b",2n]])),expression=parseExpression(source),failure=Error("operation");
    let current:Expression|undefined;context.position=node=>{current=node;};
    const fail=()=>{throw failure;};context.binary=fail;context.unary=fail;context.compare=fail;context.attribute=fail;
    expect(()=>evaluateExpression(expression,context,budget())).toThrow(failure);
    expect(current).toBe(expression);
  });

  it("does not visit skipped logical operands or conditional branches",()=>{
    const {context}=environment(new Map<string,Value>([["a",1n],["b",2n],["skip",3n]])),seen:string[]=[];
    context.position=node=>{if(node.kind==="name")seen.push(node.name);};
    expect(evaluateExpression(parseExpression("(a or skip) if b else skip"),context,budget())).toBe(1n);
    expect(seen).toEqual(["b","a"]);
  });

  it.each([false,true])("prioritizes position callback cancellation before guest operations (throws=%s)",throws=>{
    const {context,events}=environment(new Map<string,Value>([["a",1n]])),controller=new AbortController();
    context.position=()=>{controller.abort();if(throws)throw Error("position failure");};
    expect(()=>evaluateExpression(parseExpression("a"),context,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:10000,signal:controller.signal}))).toThrow(ExecutionLimitError);
    expect(events).toEqual([]);
  });

  it("preserves ordinary position callback failures",()=>{
    const {context,events}=environment(),failure=Error("position failure");context.position=()=>{throw failure;};
    expect(()=>evaluateExpression(parseExpression("a"),context,budget())).toThrow(failure);expect(events).toEqual([]);
  });

  it("retains operand location when operand evaluation fails",()=>{
    const {context}=environment(new Map<string,Value>([["a",1n]])),expression=parseExpression("(a +\n missing)");
    let current:Expression|undefined;context.position=node=>{current=node;};
    expect(()=>evaluateExpression(expression,context,budget())).toThrow("missing:missing");
    expect(current?.kind).toBe("name");expect(current?.start.line).toBe(2);
  });

  it("attributes awaited and delegated operations to their owning expressions",()=>{
    for(const source of ["(await\n a)","(yield from\n a)"]){
      const {context}=environment(new Map<string,Value>([["a",1n]])),expression=parseExpression(source),failure=Error("injected");
      let current:Expression|undefined;context.position=node=>{current=node;};
      const delegate=function*(){expect(current).toBe(expression);yield 1n;return 2n;};context.awaitValue=delegate;context.delegate=delegate;
      const cursor=createExpressionContinuation(expression,context,budget(),null);
      expect(cursor.next()).toEqual({done:false,value:1n});expect(current).toBe(expression);
      expect(()=>cursor.throw(failure)).toThrow(failure);expect(current).toBe(expression);
    }
  });

  it("meters observed continuation records before operand effects",()=>{
    const {context,events}=environment(new Map<string,Value>([["a",1n],["b",2n]]));context.position=()=>{};
    expect(()=>evaluateExpression(parseExpression("a+b"),context,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:192}))).toThrow(ExecutionLimitError);
    expect(events).toEqual([]);
  });
  it("restores owning expression locations before deferred operations",()=>{
    const {context}=environment(new Map<string,Value>([["a",1n],["b",2n],["c",3n]])),seen:string[]=[];
    let current:Expression|undefined;
    context.position=node=>{current=node;};
    const binary=context.binary;
    context.binary=(operator,left,right)=>{seen.push(`${operator}:${current?.kind}:${current?.start.line}`);return binary(operator,left,right);};
    expect(evaluateExpression(parseExpression("(a +\n b *\n c)"),context,budget())).toBe(7n);
    expect(seen).toEqual(["*:binary:2","+:binary:1"]);
  });

  it("attributes suspension to yield and restores parent ownership after resumption",()=>{
    const {context}=environment(new Map<string,Value>([["a",1n],["b",2n]]));
    let current:Expression|undefined;context.position=node=>{current=node;};
    const cursor=createExpressionContinuation(parseExpression("(a +\n (yield\n b))"),context,budget(),null);
    expect(cursor.next()).toEqual({done:false,value:2n});expect(current?.kind).toBe("yield");expect(current?.start.line).toBe(2);
    expect(cursor.next(3n)).toEqual({done:true,value:4n});expect(current?.kind).toBe("binary");expect(current?.start.line).toBe(1);
  });
  it("retains operands across nested awaits without replaying their sources",()=>{
    const {context,events}=environment(new Map<string,Value>([["a",10n],["b",20n]]));
    context.awaitValue=function*(source){events.push(`await:${source}`);return yield source;};
    const cursor=createExpressionContinuation(parseExpression("a + await (await b)"),context,budget(),null);
    expect(cursor.next()).toEqual({done:false,value:20n});
    expect(cursor.next(2n)).toEqual({done:false,value:2n});
    expect(cursor.next(3n)).toEqual({done:true,value:13n});
    expect(events).toEqual(["load:a","load:b","await:20","await:2","binary:+"]);
  });

  it("rejects unavailable or synchronous await before source side effects",()=>{
    const {context,events}=environment(new Map<string,Value>([["a",1n]])),expression=parseExpression("await a");
    expect(()=>createExpressionContinuation(expression,context,budget(),null).next()).toThrow("await");
    context.awaitValue=function*(){yield 1n;return 2n;};
    expect(()=>evaluateExpression(expression,context,budget())).toThrow("await");
    expect(events).toEqual([]);
  });

  it("delivers a thrown exception to the suspended await without later operand effects",()=>{
    const {context,events}=environment(new Map<string,Value>([["a",1n],["b",2n]])),failure=Error("injected");
    context.awaitValue=function*(source){yield source;return 9n;};
    const cursor=createExpressionContinuation(parseExpression("await a + b"),context,budget(),null);
    expect(cursor.next()).toEqual({done:false,value:1n});expect(()=>cursor.throw(failure)).toThrow(failure);
    expect(events).toEqual(["load:a"]);
  });

  it("retains operands while a yield-from source itself yields, then uses the delegated return",()=>{
    const {context,events}=environment(new Map<string,Value>([["a",10n],["b",20n]])),meter=budget();
    context.delegate=function*(source){
      events.push("delegate");yield source;events.push("return");return 9n;
    };
    const cursor=createExpressionContinuation(parseExpression("a + (yield from (yield b))"),context,meter,null);
    expect(cursor.next()).toEqual({done:false,value:20n});
    expect(cursor.next(2n)).toEqual({done:false,value:2n});
    expect(cursor.next(null)).toEqual({done:true,value:19n});
    expect(events).toEqual(["load:a","load:b","delegate","return","binary:+"]);
  });

  it("rejects unavailable or synchronous delegation before source side effects",()=>{
    const {context,events}=environment(new Map<string,Value>([["a",1n]])),expression=parseExpression("(yield from a)");
    expect(()=>createExpressionContinuation(expression,context,budget(),null).next()).toThrow("yield-from");
    context.delegate=function*(){yield 1n;return 2n;};
    expect(()=>evaluateExpression(expression,context,budget())).toThrow("yield-from");
    expect(events).toEqual([]);
  });

  it("suspends binary operands without repeating earlier loads or operations",()=>{
    const {context,names,events}=environment(new Map<string,Value>([["a",10n],["b",20n],["c",30n]]));
    const cursor=createExpressionContinuation(parseExpression("a + (yield b) * c"),context,budget(),null);
    expect(events).toEqual([]);
    expect(cursor.next()).toEqual({done:false,value:20n});
    expect(events).toEqual(["load:a","load:b"]);
    names.set("a",100n);names.set("c",3n);
    expect(cursor.next(7n)).toEqual({done:true,value:31n});
    expect(events).toEqual(["load:a","load:b","load:c","binary:*","binary:+"]);
  });

  it("preserves nested yields and uses guest None for bare yield",()=>{
    const {context}=environment();
    const cursor=createExpressionContinuation(parseExpression("(yield (yield))"),context,budget(),null);
    expect(cursor.next()).toEqual({done:false,value:null});
    expect(cursor.next(2n)).toEqual({done:false,value:2n});
    expect(cursor.next(3n)).toEqual({done:true,value:3n});
  });

  it("retains direct branch-mode short-circuiting across a yield",()=>{
    const {context,events}=environment(new Map<string,Value>([["a",5n],["b",7n]]));
    const cursor=createExpressionContinuation(parseExpression("(yield a) and b"),context,budget(),null,"branch");
    expect(cursor.next()).toEqual({done:false,value:5n});
    expect(cursor.next(0n)).toEqual({done:true,value:false});
    expect(events).toEqual(["load:a","truth"]);
  });

  it("delivers injected exceptions at the yield without evaluating later operands",()=>{
    const {context,events}=environment(new Map<string,Value>([["a",5n],["b",7n]])),failure=Error("injected");
    const cursor=createExpressionContinuation(parseExpression("(yield a) + b"),context,budget(),null);
    expect(cursor.next()).toEqual({done:false,value:5n});
    expect(()=>cursor.throw(failure)).toThrow(failure);
    expect(cursor.next(null)).toEqual({done:true,value:undefined});
    expect(events).toEqual(["load:a"]);
  });

  it("retains call collectors and evaluates later arguments only after resume",()=>{
    const {context,names,events}=environment(new Map<string,Value>([["fn","function"],["a",1n],["b",2n],["c",3n]]));
    context.beginCall=callee=>({
      positional:value=>{events.push(`arg:${value}`);},starred(){throw Error("unexpected star");},keywords(){throw Error("unexpected keywords");},mapping(){throw Error("unexpected mapping");},
      invoke(){events.push(`invoke:${callee}`);return 99n;}
    });
    const cursor=createExpressionContinuation(parseExpression("fn(a,(yield b),c)"),context,budget(),null);
    expect(cursor.next()).toEqual({done:false,value:2n});
    expect(events).toEqual(["load:fn","load:a","arg:1","load:b"]);
    names.set("fn","replacement");names.set("c",30n);
    expect(cursor.next(7n)).toEqual({done:true,value:99n});
    expect(events).toEqual(["load:fn","load:a","arg:1","load:b","arg:7","load:c","arg:30","invoke:function"]);
  });

  it("retains dictionary keys across suspension before their values",()=>{
    const {context,events}=environment(new Map<string,Value>([["a",1n],["b",2n],["c",3n],["d",4n]]));
    let entries:readonly (readonly [Value,Value])[]=[];
    context.beginDictionary=initial=>{entries=initial;return {set(){throw Error("unexpected incremental insertion");},update(){throw Error("unexpected update");},finish:()=>null};};
    const cursor=createExpressionContinuation(parseExpression("{a:(yield b),c:d}"),context,budget(),null);
    expect(cursor.next()).toEqual({done:false,value:2n});expect(entries).toEqual([]);
    expect(cursor.next(7n)).toEqual({done:true,value:null});
    expect(entries).toEqual([[1n,7n],[3n,4n]]);expect(events).toEqual(["load:a","load:b","load:c","load:d"]);
  });

  it("suspends f-string values and format specs without repeating conversion",()=>{
    const {context,events}=environment(new Map<string,Value>([["a",1n],["b",2n]]));
    context.formattedString={
      text:points=>typeof points==="string"?points:String.fromCodePoint(...points),
      convert(value,code){events.push(`convert:${code}:${value}`);return `${code}(${value})`;},
      format(value,spec){events.push(`format:${value}:${spec}`);return spec===undefined?value:`${value}:${spec}`;},join:parts=>parts.join("")
    };
    const cursor=createExpressionContinuation(parseExpression("f'{(yield a)!r:{(yield b)}}'"),context,budget(),null);
    expect(cursor.next()).toEqual({done:false,value:1n});
    expect(cursor.next("x")).toEqual({done:false,value:2n});
    expect(events).toEqual(["load:a","convert:r:x","load:b"]);
    expect(cursor.next("3")).toEqual({done:true,value:"r(x):3"});
    expect(events.filter(event=>event.startsWith("convert:"))).toHaveLength(1);
  });

  it("captures subscript references across suspension without reading the item",()=>{
    const {context,names}=environment(new Map<string,Value>([["obj","original"],["key",1n]]));
    const expression=parseExpression("obj[(yield key)]");
    if(expression.kind!=="subscript")throw Error("expected subscript");
    const cursor=createExpressionContinuation(expression,context,budget(),null,"subscript-reference");
    expect(cursor.next()).toEqual({done:false,value:1n});names.set("obj","replacement");
    expect(cursor.next(7n)).toEqual({done:true,value:{object:"original",key:7n}});
  });

  it("retains deep continuation stacks without recursive host resumption",()=>{
    const {context}=environment(new Map([["a",1n]]));
    const cursor=createExpressionContinuation(parseExpression("(yield a)"+"+a".repeat(5000)),context,budget(),null);
    expect(cursor.next()).toEqual({done:false,value:1n});
    expect(cursor.next(1n)).toEqual({done:true,value:5001n});
  });

  it("checks cancellation before yield publication and before resumed callbacks",()=>{
    for(const stage of ["yield","resume"]) {
      const controller=new AbortController(),{context,events}=environment(new Map<string,Value>([["a",1n],["b",2n]]));
      const load=context.load;
      context.load=name=>{const value=load(name);if(stage==="yield")controller.abort();return value;};
      const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000,signal:controller.signal});
      const cursor=createExpressionContinuation(parseExpression("(yield a)+b"),context,meter,null);
      if(stage==="resume"){expect(cursor.next()).toEqual({done:false,value:1n});controller.abort();}
      expect(()=>cursor.next(7n)).toThrow("execution cancelled");expect(events).toEqual(["load:a"]);
    }
  });

  it("keeps synchronous yield rejection ahead of operand effects",()=>{
    const {context,events}=environment(new Map([["a",1n]]));
    expect(()=>evaluateExpression(parseExpression("(yield a)"),context,budget())).toThrow("expression execution is not implemented for yield");
    expect(events).toEqual([]);
  });

  it("reserves continuation storage before allocation or operand execution",()=>{
    const {context,events}=environment(new Map([["a",1n]]));
    const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:223});
    expect(()=>createExpressionContinuation(parseExpression("(yield a)"),context,meter,null)).toThrow("execution allocation limit exceeded");
    expect(events).toEqual([]);
  });
});

describe("expression execution order", () => {
  it.each([["{}", 0], ["{**x}", 0], ["x[1:2]", 32]] as const)("charges empty dictionary and slice temporaries before callbacks: %s", (source, maxAllocatedBytes) => {
    const { context } = environment(new Map([["x", 1n]]));
    let callbacks = 0;
    context.beginDictionary = () => { callbacks++; return { set() {}, update() {}, finish: () => null }; };
    context.slice = () => { callbacks++; return null; };
    context.getItem = () => null;
    const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes:192+maxAllocatedBytes });
    expect(() => evaluateExpression(parseExpression(source), context, meter)).toThrow("execution allocation limit exceeded");
    expect(callbacks).toBe(0);
  });
  it.each(["literal", "load", "binary", "list", "truth"])("observes cancellation from the terminal %s callback", hook => {
    const controller = new AbortController(), { context } = environment(new Map([["x", 1n]]));
    let source = "x";
    if (hook === "literal") { source = "1"; context.literal = () => { controller.abort(); return 1n; }; }
    if (hook === "load") context.load = () => { controller.abort(); return 1n; };
    if (hook === "binary") { source = "1+2"; context.binary = () => { controller.abort(); return 3n; }; }
    if (hook === "list") { source = "[]"; context.list = () => { controller.abort(); return null; }; }
    if (hook === "truth") context.truth = () => { controller.abort(); return true; };
    const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000, signal: controller.signal });
    expect(() => hook === "truth" ? evaluateExpression(parseExpression(source), context, meter, "branch")
      : evaluateExpression(parseExpression(source), context, meter)).toThrow("execution cancelled");
  });
  it.each(["[1, 2]", "(1, 2)", "{1, 2}", "{1: 2}", "x[1, 2]"])("charges temporary collection buffers: %s", source => {
    const { context } = environment(new Map([["x", 0n]]));
    context.list = context.tuple = context.getItem = () => null;
    context.beginSet = () => ({ add() {}, update() {}, finish: () => null });
    context.beginDictionary = () => ({ set() {}, update() {}, finish: () => null });
    const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 192+32 });
    expect(() => evaluateExpression(parseExpression(source), context, meter)).toThrow("execution allocation limit exceeded");
  });
  it.each(["[*x]", "(*x,)", "x[*x]"])("bounds guest-controlled starred buffers: %s", source => {
    const { context } = environment(new Map([["x", 0n]]));
    let pulls = 0, finished = false;
    context.iterate = () => ({ next: () => { pulls++; return { done: false, value: 1n }; } });
    context.list = context.tuple = context.getItem = () => { finished = true; return null; };
    // Reserve the evaluator frame, then leave exactly 40 bytes for this buffer.
    const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 192+40 });
    expect(() => evaluateExpression(parseExpression(source), context, meter)).toThrow("execution allocation limit exceeded");
    expect(pulls).toBe(2); expect(finished).toBe(false);
  });
  it("evaluates f-string conversion before nested format specs and later fields", () => {
    const { context, events } = environment(new Map<string, Value>([["x", "X"], ["w", "W"], ["y", "Y"]]));
    context.formattedString = {
      text: points => typeof points === "string" ? points : String.fromCodePoint(...points),
      convert: (value, code) => { events.push(`convert:${code}:${value}`); return `${code}(${value})`; },
      format: (value, spec) => { events.push(`format:${value}:${spec ?? "absent"}`); return spec === undefined ? value : `${value}<${spec}>`; },
      join: parts => parts.join("")
    };
    expect(evaluateExpression(parseExpression('f"head {x!r:>{w}} {y!s}"'), context, budget())).toBe("head r(X)<>W> s(Y)");
    expect(events).toEqual(["load:x", "convert:r:X", "load:w", "format:W:absent", "format:r(X):>W", "load:y", "convert:s:Y", "format:s(Y):absent"]);
  });
  it("keeps f-string debug labels, empty specs and conditional truth distinct", () => {
    const { context } = environment(new Map<string, Value>([["x", "X"]]));
    context.formattedString = {
      text: points => typeof points === "string" ? points : String.fromCodePoint(...points),
      convert: (value, code) => `${code}(${value})`,
      format: (value, spec) => spec === undefined ? value : `${value}[${spec}]`,
      join: parts => parts.join("")
    };
    expect(evaluateExpression(parseExpression('f"{x=}|{x=:}"'), context, budget())).toBe("x=r(X)|x=X[]");
    expect(evaluateExpression(parseExpression('f""'), context, budget(), "branch")).toBe(false);
    expect(evaluateExpression(parseExpression('f"{x}"'), context, budget(), "branch")).toBe(true);
    expect(() => evaluateExpression(parseExpression('t"{x}"'), context, budget())).toThrow("expression execution is not implemented for interpolated-string");
  });
  it("stops before nested spec evaluation when f-string conversion fails", () => {
    const { context, events } = environment(new Map<string, Value>([["x", "X"]])), error = Error("conversion");
    context.formattedString = {
      text: () => "", convert: () => { throw error; }, format: () => "", join: () => ""
    };
    expect(() => evaluateExpression(parseExpression('f"{x!r:{missing}}"'), context, budget())).toThrow(error);
    expect(events).toEqual(["load:x"]);
  });
  it("evaluates nested f-string expressions using the same continuation stack", () => {
    const { context } = environment(new Map<string, Value>([["x", "X"]]));
    context.formattedString = {
      text: points => typeof points === "string" ? points : String.fromCodePoint(...points),
      convert: value => value, format: value => value, join: parts => parts.join("")
    };
    expect(evaluateExpression(parseExpression(`f"outer {f'inner {x}'}"`), context, budget())).toBe("outer inner X");
  });
  it("returns host truth in branch mode while preserving ordinary value mode", () => {
    const { context } = environment(new Map([["a", 7n]]));
    expect(evaluateExpression(parseExpression("a"), context, budget(), "branch")).toBe(true);
    expect(evaluateExpression(parseExpression("a"), context, budget())).toBe(7n);
  });

  it.each(["a and missing", "not (a and missing)", "(a and missing) if True else missing"])("does not repeat a stateful truth conversion at the branch boundary: %s", source => {
    const { context } = environment(new Map([["a", 0n]]));
    let calls = 0;
    context.truth = value => typeof value === "boolean" ? value : ++calls > 1;
    expect(evaluateExpression(parseExpression(source), context, budget(), "branch")).toBe(source.startsWith("not"));
    expect(calls).toBe(1);
  });

  it("preserves the walrus value boundary inside branch mode", () => {
    const { context, names } = environment(new Map([["a", 0n]]));
    let calls = 0;
    context.truth = () => ++calls > 1;
    expect(evaluateExpression(parseExpression("(x := (a and missing))"), context, budget(), "branch")).toBe(true);
    expect(calls).toBe(2);
    expect(names.get("x")).toBe(0n);
  });

  it("does not retest a short-circuited comparison chain in branch mode", () => {
    const { context } = environment();
    let calls = 0;
    context.compare = () => "comparison";
    context.truth = () => ++calls > 1;
    expect(evaluateExpression(parseExpression("1 < 2 < missing"), context, budget(), "branch")).toBe(false);
    expect(calls).toBe(1);
  });

  it("checks the budget before the final guest truth conversion", () => {
    const { context, events } = environment();
    expect(() => evaluateExpression(parseExpression("1"), context, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 1000 }), "branch")).toThrow("execution step limit exceeded");
    expect(events).toEqual([]);
    context.truth = () => { throw new Error("guest truth failed"); };
    expect(() => evaluateExpression(parseExpression("1"), context, budget(), "branch")).toThrow("guest truth failed");
  });

  it("drives statement branches without converting an already-tested value again", () => {
    const { context } = environment(new Map([["a", 0n]])), meter = budget(), outputs: Value[] = [];
    let calls = 0;
    context.truth = () => ++calls > 1;
    executeStatements(parseModule("if a and missing:\n  1\nelse:\n  2").body, {
      evaluate: expression => evaluateExpression(expression, context, meter),
      test: expression => evaluateExpression(expression, context, meter, "branch"),
      iterate: () => { throw new Error("unused"); },
      assign: () => { throw new Error("unused"); },
      execute: statement => {
        if (statement.kind !== "expression-statement") throw new Error("unused");
        outputs.push(evaluateExpression(statement.expression, context, meter));
      }
    }, meter);
    expect(outputs).toEqual([2n]);
    expect(calls).toBe(1);
  });

  it("executes parsed arithmetic using runtime operations", () => {
    const { context } = environment();
    expect(evaluateExpression(parseExpression("-7 // 3 + 2 * 5"), context, budget())).toBe(7n);
  });

  it("evaluates operands left to right", () => {
    const { context, events } = environment(new Map([["a", 2n], ["b", 3n], ["c", 4n]]));
    expect(evaluateExpression(parseExpression("a + b * c"), context, budget())).toBe(14n);
    expect(events).toEqual(["load:a", "load:b", "load:c", "binary:*", "binary:+"]);
  });

  it("short-circuits and/or and returns the selected operand without coercion", () => {
    const { context, events } = environment();
    expect(evaluateExpression(parseExpression("0 and missing"), context, budget())).toBe(0n);
    expect(evaluateExpression(parseExpression("5 or missing"), context, budget())).toBe(5n);
    expect(evaluateExpression(parseExpression("0 or 9"), context, budget())).toBe(9n);
    expect(events).toEqual(["truth", "truth", "truth"]);
  });

  it("selects only one conditional branch, including unsupported inactive syntax", () => {
    const { context, events } = environment();
    expect(evaluateExpression(parseExpression("7 if True else (lambda: missing)"), context, budget())).toBe(7n);
    expect(evaluateExpression(parseExpression("missing if False else 8"), context, budget())).toBe(8n);
    expect(events).toEqual(["truth", "truth"]);
  });

  it("does not repeat a truth test through nested logical and conditional contexts", () => {
    const { context, events } = environment(new Map([["a", 0n]]));
    expect(evaluateExpression(parseExpression("a and missing and missing"), context, budget())).toBe(0n);
    expect(events).toEqual(["load:a", "truth"]);
    events.length = 0;
    expect(evaluateExpression(parseExpression("9 if (a and missing) else 8"), context, budget())).toBe(8n);
    expect(events).toEqual(["load:a", "truth"]);
  });

  it("retests a value after a walrus value boundary", () => {
    const { context, events } = environment(new Map([["a", 0n]]));
    expect(evaluateExpression(parseExpression("(x := (a and missing)) or 9"), context, budget())).toBe(9n);
    expect(events).toEqual(["load:a", "truth", "store:x", "truth"]);
  });

  it("propagates truth-test context through not without repeating guest truth conversion", () => {
    const { context, events } = environment(new Map([["a", 0n]]));
    expect(evaluateExpression(parseExpression("7 if not (a and missing) else 8"), context, budget())).toBe(7n);
    expect(events).toEqual(["load:a", "truth"]);
  });

  it("preserves value-context truth calls for not used as a boolean operand", () => {
    const { context, events } = environment(new Map([["a", 0n]]));
    evaluateExpression(parseExpression("(not (a and missing)) and 9"), context, budget());
    expect(events.filter(event => event === "truth")).toHaveLength(3);
  });

  it("retests a declined comparison chain used as a value-producing boolean operand", () => {
    const { context, events } = environment();
    context.compare = () => 0n;
    expect(evaluateExpression(parseExpression("(1 < 2 < missing) and 9"), context, budget())).toBe(0n);
    expect(events).toEqual(["truth", "truth"]);
  });

  it("retests the selected conditional value in a value-producing boolean expression", () => {
    const { context, events } = environment(new Map([["a", 1n]]));
    expect(evaluateExpression(parseExpression("((a or missing) if True else missing) and 9"), context, budget())).toBe(9n);
    expect(events).toEqual(["truth", "load:a", "truth", "truth"]);
  });

  it("retains the alternate branch short-circuit test through a surrounding logical expression", () => {
    const { context, events } = environment(new Map([["a", 1n]]));
    expect(evaluateExpression(parseExpression("(missing if False else (a or missing)) and 9"), context, budget())).toBe(9n);
    expect(events).toEqual(["truth", "load:a", "truth"]);
  });

  it("evaluates chained comparison intermediates once and does not truth-test the last result", () => {
    const { context, events } = environment(new Map([["a", 1n], ["b", 2n], ["c", 3n]]));
    expect(evaluateExpression(parseExpression("a < b < c"), context, budget())).toBe(true);
    expect(events).toEqual(["load:a", "load:b", "compare:<", "truth", "load:c", "compare:<"]);
  });

  it("returns a false-like comparison result unchanged and skips later operands", () => {
    const { context, events } = environment();
    context.compare = () => "";
    expect(evaluateExpression(parseExpression("1 < 2 < missing"), context, budget())).toBe("");
    expect(events).toEqual(["truth"]);
  });

  it("stores a walrus value once and returns it", () => {
    const { context, names, events } = environment();
    expect(evaluateExpression(parseExpression("(x := 3) + x"), context, budget())).toBe(6n);
    expect(names.get("x")).toBe(3n);
    expect(events).toEqual(["store:x", "load:x", "binary:+"]);
  });

  it("resolves attributes after evaluating their objects", () => {
    const { context, events } = environment(new Map([["obj", "value"]]));
    expect(evaluateExpression(parseExpression("obj.first.second"), context, budget())).toBe("value.first.second");
    expect(events).toEqual(["load:obj", "attribute:first", "attribute:second"]);
  });

  it("propagates operation failures without evaluating subsequent operands", () => {
    const { context, events } = environment();
    expect(() => evaluateExpression(parseExpression("missing + (x := 1)"), context, budget())).toThrow("missing:missing");
    expect(events).toEqual(["load:missing"]);
  });

  it("uses an explicit work stack for deeply nested expression trees", () => {
    const leaf = parseExpression("1");
    let expression: Expression = leaf;
    for (let depth = 0; depth < 20000; depth++) expression = { ...leaf, kind: "unary", operator: "+", operand: expression };
    expect(evaluateExpression(expression, environment().context, budget())).toBe(1n);
  });

  it("tracks deep expression ownership without recursive host calls",()=>{
    const leaf=parseExpression("1"),{context}=environment();let expression:Expression=leaf,visits=0;
    for(let depth=0;depth<20000;depth++)expression={...leaf,kind:"unary",operator:"+",operand:expression};
    context.position=()=>{visits++;};
    expect(evaluateExpression(expression,context,new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:4000000}))).toBe(1n);
    expect(visits).toBe(40001);
  });

  it("stops before operations on cancellation or step exhaustion", () => {
    const { context, events } = environment();
    expect(() => evaluateExpression(parseExpression("(x := 1)"), context, new ExecutionBudget({ maxSteps: 2, maxAllocatedBytes: 1000 }))).toThrow("execution step limit exceeded");
    expect(events).toEqual([]);
    const controller = new AbortController(); controller.abort();
    expect(() => evaluateExpression(parseExpression("missing"), context, new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 1000, signal: controller.signal }))).toThrow("execution cancelled");
  });

  it("reports unimplemented expression families explicitly", () => {
    expect(() => evaluateExpression(parseExpression("lambda: 1"), environment().context, budget())).toThrow(expect.objectContaining({ name: "UnsupportedExpressionError", kind: "lambda" }));
  });
});
