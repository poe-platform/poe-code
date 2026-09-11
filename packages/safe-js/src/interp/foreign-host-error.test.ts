import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError"])("admits a foreign native %s without losing its diagnostics", async name => {
  const error = runInNewContext(`new ${name}("foreign")`);
  expect(await run("return [error.name,error.message]", { bindings: { error } }))
    .toMatchObject({ ok: true, returnValue: [name, "foreign"] });
});

it.each(["sync", "async"])("preserves the type of foreign errors thrown by a %s host callback", async kind => {
  const error = runInNewContext("new TypeError('foreign')");
  const fail = kind === "sync" ? () => { throw error; } : async () => { throw error; };
  expect(await run("try{await fail()}catch(error){return [error.name,error.message]}", { bindings: { fail } }))
    .toMatchObject({ ok: true, returnValue: ["TypeError", "foreign"] });
});

it("preserves foreign error aliases and only allowlisted data metadata", async () => {
  const error = runInNewContext("Object.assign(new TypeError('foreign'),{code:'EFOREIGN',secret:'private'})");
  Object.defineProperty(error, "path", { get() { throw new Error("must not read metadata accessors"); } });
  expect(await run("return [errors[0]===errors[1],errors[0].code,errors[0].secret,errors[0].path]", { bindings: { errors: [error, error] } }))
    .toMatchObject({ ok: true, returnValue: [true, "EFOREIGN", undefined, undefined] });
});

it("does not promote foreign error-shaped records to native errors", async () => {
  const error = runInNewContext("({name:'TypeError',message:'record',code:'EFAKE'})");
  expect(await run("try{fail()}catch(error){return [error.name,error.message,error.code]}", { bindings: { fail() { throw error; } } }))
    .toMatchObject({ ok: true, returnValue: ["Error", "record", undefined] });
});
