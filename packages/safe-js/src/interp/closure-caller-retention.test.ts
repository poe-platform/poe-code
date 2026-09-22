import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { run } from "../run.js";
import { interpret } from "./interpreter.js";
import { getGuestFunctionProperty } from "./object-model.js";
import { createSandboxClosure, measureSandboxData, type SandboxClosure } from "./values.js";

async function collect() {
  for (let index = 0; index < 8; index++) {
    await setImmediate();
    global.gc!();
  }
}

async function fixture(expression: string, name = "") {
  let caller!: WeakRef<object>;
  let payload!: WeakRef<object>;
  const remember = createSandboxClosure({
    call: ([value]) => {
      caller = new WeakRef(value as object);
      payload = new WeakRef(getGuestFunctionProperty(value as SandboxClosure, "payload") as object);
      return undefined;
    }
  });
  const result = await interpret(
    parseModule(`{
    let factory=function ${name}(){return ${expression};};
    factory.payload={text:"x".repeat(60000)};
    remember(factory);
    let kept=factory();factory=null;return kept;
  }`).body[0],
    { bindings: { remember } }
  );
  if (!result.ok) throw new Error(result.error.message);
  return { closure: result.returnValue as SandboxClosure, caller, payload };
}

// Run with --pool=forks --execArgv=--expose-gc. Weak references alone are not
// evidence of collection: both the live closure and a strong lexical control
// remain observable after explicit collections in different jobs.
it
  .skipIf(typeof global.gc !== "function")
  .each([
    "()=>7",
    "function(){return 7}",
    "async ()=>7",
    "function*(){yield 7}",
    "async function*(){yield 7}"
  ])("does not retain the creating callee for %s", async (expression) => {
  const { closure, caller, payload } = await fixture(expression);
  await collect();
  expect(caller.deref()).toBeUndefined();
  expect(payload.deref()).toBeUndefined();
  expect(measureSandboxData([closure])).toBeLessThan(60000);
  const invocation = expression.includes("function*")
    ? expression.startsWith("async")
      ? "(await kept().next()).value"
      : "kept().next().value"
    : "await kept()";
  const result = await interpret(parseModule(`{return ${invocation}}`).body[0], {
    bindings: { kept: closure }
  });
  expect(result).toMatchObject({ ok: true, returnValue: 7 });
});

it.skipIf(typeof global.gc !== "function")(
  "retains and accounts for a caller captured by its self binding",
  async () => {
    const { closure, caller, payload } = await fixture("()=>self", "self");
    await collect();
    expect(caller.deref()).toBeDefined();
    expect(payload.deref()).toBeDefined();
    expect(await closure.call([])).toBe(caller.deref());
    expect(measureSandboxData([closure])).toBeGreaterThanOrEqual(60000);
  }
);

it.each([
  [
    'let outer=Function("return function(){return arguments.callee}");let inner=outer();return inner()===inner;',
    true
  ],
  [
    'let outer=Function("return ()=>arguments.callee");let inner=outer();return inner()===outer;',
    true
  ],
  [
    'let outer=Function("return function*(){yield arguments.callee}");let inner=outer();return inner().next().value===inner;',
    true
  ],
  [
    'let outer=Function("return function Self(){this.correct=new.target===Self}");return new (outer())().correct;',
    true
  ],
  [
    "function make(){let value=0;return [()=>++value,()=>value]}let [write,read]=make();write();return read();",
    1
  ],
  ['function make(){let value=7;return ()=>eval("value")}return make()();', 7]
])("preserves invocation and lexical bindings: %s", async (source, expected) => {
  expect(await run(source as string)).toMatchObject({
    ok: true,
    returnValue: expected
  });
});
