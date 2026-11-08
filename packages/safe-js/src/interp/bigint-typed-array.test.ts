import { describe, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { deepCopyToSandbox, deepCopyFromSandbox, isSandboxClosure } from "./values.js";
import { encodeReplayData, decodeReplayData } from "../snapshot/replay-data.js";
import { serialize } from "../snapshot/serialize.js";
import { restore as restoreRuntime } from "../snapshot/restore.js";
import { Budget } from "./budget.js";
import { createNumericTypedArrayGlobal } from "./globals/numeric-typed-array.js";
import { declareHostOperation } from "./host-bridge.js";

it.each(["BigInt64Array", "BigUint64Array"])(
  "supports %s construction and indexed BigInt reads",
  async (name) => {
    const source = `const values=new ${name}([1n,2n]);return [values.length,values[0],values[1]]`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: Function(source)() });
  }
);

describe.each(["BigInt64Array", "BigUint64Array"])("%s native parity", (name) => {
  const cases = [
    [
      "wrapping and primitive coercion",
      `return Array.from(new T([-1n, 2n**63n, 2n**64n+7n, true, "42"]))`
    ],
    ["static factories", `return [Array.from(T.of(3n,4n)),Array.from(T.from([1n,2n],x=>x+1n))]`],
    [
      "indexed and descriptor writes",
      `const a=new T(2);a[0]="12";Object.defineProperty(a,"1",{value:true});return Array.from(a)`
    ],
    [
      "coercion hooks",
      `const trace=[];const a=new T([{[Symbol.toPrimitive](hint){trace.push(hint);return 3n}}]);a.fill({valueOf(){trace.push("fill");return 4n}});return [trace,Array.from(a)]`
    ],
    [
      "mapped and filtered values",
      `const a=new T([1n,2n,3n]);return [Array.from(a.map(x=>x+10n)),Array.from(a.filter(x=>x>1n)),a.reduce((x,y)=>x+y,0n)]`
    ],
    [
      "sort and copy methods",
      `const a=new T([3n,1n,2n]);return [Array.from(a.toSorted()),Array.from(a.toReversed()),Array.from(a.with(1,7n)),Array.from(a.sort((x,y)=>x<y?-1:x>y?1:0))]`
    ],
    [
      "buffer aliasing",
      `const a=new T([1n,2n,3n]);const b=new T(a.buffer,8,2);b[0]=9n;return [Array.from(a),Array.from(a.subarray(1)),Array.from(a.slice(1)),ArrayBuffer.isView(a)]`
    ],
    [
      "overlapping set",
      `const a=new T([1n,2n,3n,4n]);a.set(a.subarray(0,3),1);return Array.from(a)`
    ],
    ["array-like set", `const a=new T(3);a.set({length:2,0:"8",1:true},1);return Array.from(a)`],
    [
      "search and iterator values",
      `const a=new T([1n,2n]);return [a.includes(1n),a.includes(1),a.indexOf(2n),a.find(x=>x>1n),Array.from(a.entries()),a.join(":"),a.at(-1)]`
    ],
    [
      "empty content-type mismatches",
      `const errors=[];for(const operation of [()=>new T(new Uint8Array(0)),()=>new Uint8Array(new T(0)),()=>new T(0).set(new Uint8Array(0)),()=>new Uint8Array(0).set(new T(0))]){try{operation();errors.push("accepted")}catch(e){errors.push(e.name)}}return errors`
    ],
    [
      "invalid element conversions",
      `const errors=[];for(const value of [1,null,undefined,Symbol("x"),"1.5"]){try{new T([value]);errors.push("accepted")}catch(e){errors.push(e.name)}}return errors`
    ],
    [
      "invalid index still coerces",
      `const trace=[];const a=new T(0);a[-1]={valueOf(){trace.push("convert");return 1n}};try{a[0]=1}catch(e){trace.push(e.name)}return trace`
    ],
    [
      "resizable storage",
      `const buffer=new ArrayBuffer(16,{maxByteLength:32});const a=new T(buffer);a[0]=7n;buffer.resize(32);a[3]=9n;return [a.length,Array.from(a)]`
    ],
    [
      "structured cloning",
      `const a=new T([1n,2n]);const copy=structuredClone({a,buffer:a.buffer});return [copy.a instanceof T,copy.a.buffer===copy.buffer,Array.from(copy.a)]`
    ],
    [
      "mutating methods",
      `const a=new T([1n,2n,3n,4n]);a.copyWithin(1,2);a.reverse();a.fill("9",1,3);return [Array.from(a),a.toString(),a.toLocaleString("en-US")]`
    ],
    [
      "all callback methods",
      `const a=new T([1n,2n,3n]);const seen=[];a.forEach((x,i)=>seen.push([typeof x,i]));return [seen,a.every(x=>x>0n),a.some(x=>x===2n),a.findIndex(x=>x===2n),a.findLast(x=>x>1n),a.findLastIndex(x=>x>1n),a.reduceRight((x,y)=>x-y),a.lastIndexOf(2n),Array.from(a.keys())]`
    ],
    [
      "reject numeric replacement values",
      `const a=new T([1n,2n]);const errors=[];for(const operation of [()=>a.fill(1),()=>a.with(0,1),()=>a.set([1]),()=>a.map(()=>1),()=>T.of(1),()=>T.from([1]),()=>a.sort(()=>1n)]){try{operation();errors.push("accepted")}catch(e){errors.push(e.name)}}return errors`
    ],
    [
      "species content-type checks",
      `const a=new T(0);a.constructor={[Symbol.species]:Uint8Array};const errors=[];for(const operation of [()=>a.map(x=>x),()=>a.filter(()=>true),()=>a.slice(),()=>a.subarray()]){try{operation();errors.push("accepted")}catch(e){errors.push(e.name)}}return errors`
    ],
    [
      "detached storage",
      `const a=new T([1n]);a.buffer.transfer();const errors=[];for(const operation of [()=>a.slice(),()=>a.set([]),()=>new T(a),()=>a.values()]){try{operation();errors.push("accepted")}catch(e){errors.push(e.name)}}return [a.length,errors]`
    ]
  ];

  it.each(cases)("%s", async (_label, body) => {
    const source = `const T=${name};${body}`;
    // Node 22/24 omit TypedArraySpeciesCreate's content-type check for empty
    // arrays (and subarray). ECMA-262 23.2.4.3 explicitly requires TypeError.
    const expected =
      _label === "species content-type checks"
        ? ["TypeError", "TypeError", "TypeError", "TypeError"]
        : Function(source)();
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("preserves methods and backing aliases in public snapshots", async () => {
    const source = `const a=new ${name}([1n,2n]);const b=a.subarray(1);const map=a.map;await 0;return [a instanceof ${name},a.buffer===b.buffer,map===a.map,Array.from(b.map(x=>x+1n))]`;
    const result = await run(source);
    expect(result).toMatchObject({ ok: true, returnValue: [true, true, true, [3n]] });
    const snapshot = restore(JSON.parse(await dump(result)), { source });
    expect(await run(source, { snapshot })).toMatchObject({
      ok: true,
      returnValue: result.returnValue
    });
  });

  it("uses BigInt locale methods when invoked through the SDK closure", async () => {
    const values = (
      await run(
        `BigInt.prototype.toLocaleString=function(){return "big"};return [${name}.prototype.toLocaleString,new ${name}([1n,2n])]`
      )
    ).returnValue;
    if (!Array.isArray(values) || !isSandboxClosure(values[0]))
      throw new Error("Missing locale method");
    expect(await values[0].call([], { stack: [], thisValue: values[1] })).toBe("big,big");
  });

  it("restores out-of-bounds fixed and tracking views", async () => {
    const source = `const buffer=new ArrayBuffer(16,{maxByteLength:32});const a=new ${name}(buffer,8,1);const b=new ${name}(buffer,8);buffer.resize(0);return ()=>{buffer.resize(32);a[0]=7n;return [a.length,b.length,b[0],a.buffer===b.buffer]}`;
    const result = await run(source);
    expect(result.ok).toBe(true);
    const saved = serialize({
      source,
      currentAstNodeId: 1,
      scopeChain: [{ id: "external", bindings: { read: result.returnValue } }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });
    const binding = restoreRuntime(JSON.parse(JSON.stringify(saved)), {
      source
    }).currentScope.lookup("read");
    if (!binding.found || !isSandboxClosure(binding.value))
      throw new Error("Missing restored closure");
    expect(await binding.value.call([])).toEqual([1, 3, 7n, true]);
  });

  it("transports BigInt elements through host operations", async () => {
    let calls = 0;
    const echo = declareHostOperation((value: unknown) => {
      calls++;
      return value;
    }, "re-issue");
    expect(
      await run(
        `const a=await echo(new ${name}([3n,7n]));return [a instanceof ${name},Array.from(a)]`,
        { bindings: { echo } }
      )
    ).toMatchObject({ ok: true, returnValue: [true, [3n, 7n]] });
    expect(calls).toBe(1);
  });
});

it.each([BigInt64Array, BigUint64Array])(
  "preserves %s host-copy and replay bytes and aliases",
  (Native) => {
    const a = new Native([1n, 2n]);
    const graph = { a, alias: a, buffer: a.buffer, bytes: new Uint8Array(a.buffer) };
    const copied = deepCopyToSandbox(graph);
    for (const restored of [
      deepCopyFromSandbox(copied),
      decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(copied))))
    ] as Array<typeof graph>) {
      expect(restored.a).toBeInstanceOf(Native);
      expect(Array.from(restored.a)).toEqual([1n, 2n]);
      expect(restored.a).toBe(restored.alias);
      expect(restored.a.buffer).toBe(restored.buffer);
      expect(restored.bytes.buffer).toBe(restored.buffer);
      expect(restored.buffer).not.toBe(graph.buffer);
    }
  }
);

it.each([BigInt64Array, BigUint64Array])(
  "charges %s backing bytes and supports low-level construction",
  (Native) => {
    const allowed = createNumericTypedArrayGlobal(new Budget({ dataSize: 129 }), false, Native);
    expect((allowed.construct!([16]) as InstanceType<typeof Native>).byteLength).toBe(128);
    const denied = createNumericTypedArrayGlobal(new Budget({ dataSize: 128 }), false, Native);
    expect(() => denied.construct!([16])).toThrow(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
    const constructor = createNumericTypedArrayGlobal(new Budget(), false, Native);
    expect(
      Array.from(constructor.construct!([[1n, true, "7"]]) as InstanceType<typeof Native>)
    ).toEqual([1n, 1n, 7n]);
    expect(() => constructor.construct!([[1]])).toThrow(TypeError);
  }
);

it.each([BigInt64Array, BigUint64Array])(
  "budgets %s low-level string conversion before parsing",
  (Native) => {
    const constructor = createNumericTypedArrayGlobal(new Budget({ maxSteps: 100 }), false, Native);
    expect(() => constructor.construct!([["9".repeat(1000)]])).toThrow(
      expect.objectContaining({ code: "budgetExceeded", budget: "steps" })
    );
  }
);
