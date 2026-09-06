import { expect, it } from "vitest";
import { run } from "../../run.js";
import { runInNewContext } from "node:vm";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { createUriGlobals } from "./uri.js";

const conversions = { encodeURI, encodeURIComponent, decodeURI, decodeURIComponent };

it.each(Object.entries(conversions).flatMap(([name, convert]) =>
  ["a b/🍋", "%20%2F%F0%9F%8D%8B"].map(input => ({ name, input, expected: convert(input) }))))(
  "supports $name on $input", async ({ name, input, expected }) => {
    expect(await run(`return ${name}(${JSON.stringify(input)})`)).toMatchObject({
      ok: true, returnValue: expected
    });
  }
);

it.each(Object.keys(conversions).flatMap(name => [
  "undefined", "null", "42", "true", "3n", "Symbol('x')",
  "({toString(){return 'a b'}})",
  "({[Symbol.toPrimitive](hint){if(hint!=='string')throw 9;return 'a b'}})"
].map(input => ({ name, input }))))("matches coercion for $name($input)", async ({ name, input }) => {
  const source = `try{return [${name}(${input})]}catch(error){return [error.name,error instanceof URIError,error instanceof TypeError]}`;
  const expected = runInNewContext(`(()=>{${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  ...["encodeURI", "encodeURIComponent"].flatMap(name => ["\ud800", "\udfff"].map(input => ({ name, input }))),
  ...["decodeURI", "decodeURIComponent"].flatMap(name => ["%", "%GG", "%E0%A4", "%ED%A0%80", "%C0%AF"].map(input => ({ name, input })))
])("rejects malformed input for $name: $input", async ({ name, input }) => {
  expect(await run(`try{${name}(${JSON.stringify(input)});return false}catch(error){return error instanceof URIError && error instanceof Error}`))
    .toMatchObject({ ok: true, returnValue: true });
});

it.each(Object.keys(conversions))("exposes metadata and rejects construction for %s", async name => {
  expect(await run(`let rejected=false;try{new ${name}("x")}catch(error){rejected=error instanceof TypeError}return [${name}.name,${name}.length,rejected]`))
    .toMatchObject({ ok: true, returnValue: [name, 1, true] });
});

it.each(Object.entries(conversions).flatMap(([name, convert]) => ["pending", "completed"].map(mode => ({ name, convert, mode })) ))(
  "preserves $name in $mode checkpoints", async ({ name, convert, mode }) => {
    const source = `const alias=${name};await 0;return [alias===${name},alias("a b")]`;
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      if (mode === "completed") await completed;
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      const result = await completed;
      expect(result).toMatchObject({ ok: true, returnValue: [true, convert("a b")] });
      expect(await run(source, { snapshot: result.snapshot })).toMatchObject({ ok: true, returnValue: [true, convert("a b")] });
      expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: [true, convert("a b")] });
    } finally { await completed; }
  }
);

it.each(Object.keys(conversions) as Array<keyof typeof conversions>)("charges %s input work", name => {
  const globals = createUriGlobals(new Budget({ maxSteps: 10 }));
  expect(() => globals[name].call(["%20".repeat(10)]))
    .toThrow(expect.objectContaining({ name: "SandboxError" }));
});

it.each(["encodeURI", "encodeURIComponent"] as const)("bounds %s output expansion", name => {
  const globals = createUriGlobals(new Budget({ stringLength: 4 }));
  expect(() => globals[name].call(["ą"]))
    .toThrow(expect.objectContaining({ name: "SandboxError" }));
});

it.each(Object.keys(conversions))("preserves mutable %s properties through checkpoints", async name => {
  const source = `const alias=${name};Object.defineProperty(alias,"name",{value:"changed",configurable:true});alias.extra=7;await 0;return [alias===${name},alias.name,alias.extra,alias("x")]`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: [true, "changed", 7, "x"] });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: [true, "changed", 7, "x"] });
  } finally { await completed; }
});
