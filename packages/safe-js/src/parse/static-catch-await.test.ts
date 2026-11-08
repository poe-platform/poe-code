import { Script } from "node:vm";
import { expect, it } from "vitest";
import { parseEvalScript } from "./parser.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { lint } from "../lint/index.js";

it.each([
  "try {} catch (await) {}",
  "try {} catch ({value: await}) {}",
  "try {} catch ([await]) {}",
  "{let await;}",
  "var await;",
  "function await() {}",
  "const f = (await) => await;"
])("rejects static-block await bindings: %s", body => {
  const source = `class C { static { ${body} } }`;
  expect(() => new Script(source)).toThrow(SyntaxError);
  expect(() => parseEvalScript(source)).toThrow();
});

it("preserves catch/finally order for eval early errors in original and replay", async () => {
  const source = `const trace = [];
    try { eval("trace.push('executed'); class C { static { try {} catch (await) {} } }"); }
    catch (e) { trace.push(e instanceof SyntaxError); }
    finally { trace.push('finally'); }
    return trace;`;
  expect(lint(source).filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
  const original = await run(source);
  expect(original).toMatchObject({ok: true, returnValue: [true, "finally"]});
  const replayed = await run(source, {snapshot: JSON.parse(await dump(original))});
  expect(replayed).toMatchObject({ok: true, returnValue: [true, "finally"]});
});

it("recognizes contextual resource bindings inside a static block's arrow body", async () => {
  const script = `class C { static { (() => { using await = null; })(); } }`;
  expect(() => parseEvalScript(script)).not.toThrow();
  expect(await run(`eval(${JSON.stringify(script)}); return 'disposed';`)).toMatchObject({
    ok: true, returnValue: "disposed"
  });
  expect(() => parseEvalScript("class C { static { using await = null; } }")).toThrow();
  expect(() => parseEvalScript("async function f() { using await = null; }")).toThrow();
});

it.each([
  "try {} catch (allowed) {}",
  "try {} catch ({await: allowed}) {}",
  "function f(await) { return await; }",
  "const f = function(await) { return await; };",
  "class Nested { method(await) { return await; } }"
])("allows neighboring static-block bindings across function boundaries: %s", body => {
  const source = `class C { static { ${body} } }`;
  expect(() => new Script(source)).not.toThrow();
  expect(() => parseEvalScript(source)).not.toThrow();
});
