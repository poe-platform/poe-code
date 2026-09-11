import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { createSandboxClosure } from "../values.js";
import { functionString } from "../function-string.js";

// ECMAScript 2026 section 20.2.3.5 preserves available guest source text.
// Builtins and bound callables use native-function syntax, never host source.
describe("Function string conversion", () => {
  it.each(["host-operation", "line\nbreak", "name() { exposed() }"])(
    "does not interpolate non-identifier host labels: %s",
    (name) => {
      const closure = createSandboxClosure({ name, call: () => undefined });
      expect(functionString(closure)).toBe("function () { [native code] }");
    }
  );

  it.each([
    "function named ( value ) { /* keep */ return value; }",
    "function () { return 1; }",
    "(x) => x + 1",
    "x => ({ value: x })",
    "async (x) => { return await x; }",
    "async function named (x) { return await x; }",
    "function * items () { yield 1; return 2; }",
    "function f\\u006fo() { return 'escaped'; }",
    "() => '😀'"
  ])("preserves exact text across conversion routes: %s", async (definition) => {
    const source = `const fn=((${definition}));return [fn.toString(),String(fn),\`\${fn}\`,'prefix:'.concat(fn)]`;
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "function named (x) { /* retained */ return x; } return named.toString()",
    "function* items () { yield 1; } return items.toString()",
    "async function work () { return 1; } return work.toString()",
    "const object={ method (x) { /* method */ return x; } };return object.method.toString()",
    "const object={ async method (x) { return await x; } };return object.method.toString()",
    "const object={ ['method'] (x) { return x; } };return object.method.toString()",
    "const object={ 'method' (x) { return x; } };return object.method.toString()",
    "const before='😀';const fn=()=> before;return fn.toString()",
    "return `prefix:${(function named(){return 1})}`",
    "return `prefix:${((x) => x)}`",
    "function first(){}function second (x) {return x}return first.toString.call(second)",
    "function first(){}const method=first.toString;return [method.length,typeof method]",
    "function fn(){}fn.toString=()=> 'custom';return [fn.toString(),String(fn),`${fn}`,''.concat(fn)]",
    "function first(){}function second(){return 2}second.toString=()=> 'custom';return first.toString.call(second)",
    "function fn(){}fn.toString=null;fn.valueOf=()=>7;return String(fn)",
    "function fn(){return 1}return [fn.sourceRange,Object.keys(fn)]"
  ])("preserves source and method semantics: %s", async (source) => {
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["null", "undefined", "{}", "1", "'text'", "[]"])(
    "rejects non-callable receiver %s",
    async (receiver) => {
      const source = `function fn(){}try{return fn.toString.call(${receiver})}catch(error){return error.name}`;
      expect(await run(source)).toMatchObject({ ok: true, returnValue: "TypeError" });
    }
  );

  it.each(["Number", "parseInt", "Math.abs", "''.concat", "[].map"])(
    "does not expose implementation source for %s",
    async (expression) => {
      const source = `const fn=${expression};return [fn.toString(),String(fn)]`;
      const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
      expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it("uses native-function syntax for bound functions", async () => {
    const source =
      "function target (x) {return x}const bound=target.bind(null,1);return [bound.toString(),String(bound)]";
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("does not let guest properties replace the private defining source", async () => {
    expect(
      await run(
        "function fn(){return 1}fn.sourceRange={text:'spoof',start:0,end:5};return fn.toString()"
      )
    ).toMatchObject({ ok: true, returnValue: "function fn(){return 1}" });
  });

  it.each(["fn.toString()", "String(fn)", "`${fn}`", "''.concat(fn)"])(
    "keeps string limits fatal for %s",
    async (expression) => {
      const source = `function fn(){return 1}try{return ${expression}}catch(error){return 'caught'}`;
      await expect(run(source, { budget: new Budget({ stringLength: 10 }) })).rejects.toMatchObject(
        { code: "budgetExceeded", budget: "stringLength" }
      );
    }
  );

  it("accounts for generated source text in the data budget", async () => {
    const source = `function fn(){/*${"x".repeat(5000)}*/return 1}return fn.toString()`;
    await expect(run(source, { budget: new Budget({ dataSize: 4000 }) })).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "dataSize"
    });
    expect(await run(source, { budget: new Budget({ dataSize: 20000 }) })).toMatchObject({
      ok: true,
      returnValue: runInNewContext(`(()=>{${source}})()`)
    });
  });

  it.each([
    "function named (x) { /* retained */ return x; }",
    "(x) => x + 1",
    "function* items(){yield 1}"
  ])("restores source text for %s", async (definition) => {
    const source = `const fn=(${definition});await 0;return fn.toString()`;
    const execution = run(source);
    const checkpoint = JSON.parse(await dump(execution));
    expect(checkpoint.bindings.fn).toMatchObject({ kind: "ref" });
    expect(checkpoint.heap[checkpoint.bindings.fn.id]).toMatchObject({ kind: "guest-function" });
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await execution).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot: restore(checkpoint, { source }) })).toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it("retains each function's defining source across realm evaluations", async () => {
    const realm = createRealm();
    try {
      await realm.evaluate("function first (x) { /* first source */ return x; }");
      await realm.evaluate("const second=(x)=> x + 1;");
      expect(await realm.evaluate("return [first.toString(),second.toString()]")).toMatchObject({
        ok: true,
        returnValue: ["function first (x) { /* first source */ return x; }", "(x)=> x + 1"]
      });
    } finally {
      await realm.close();
    }
  });

  it("rejects a checkpoint when observable function source changes", async () => {
    const source = "function fn(){/*aaaa*/return 1}await 0;return fn.toString()";
    const changed = "function fn(){/*bbbb*/return 1}await 0;return fn.toString()";
    const execution = run(source);
    const checkpoint = JSON.parse(await dump(execution));
    await execution;
    expect(() => restore(checkpoint, { source: changed })).toThrow("source changed since snapshot");
  });
});
