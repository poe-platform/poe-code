import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { dump, run } from "../index.js";

it.each([false, true])("preserves foreign aggregate members when renamed=%s", async renamed => {
  const error = runInNewContext("new AggregateError([new TypeError('member'),7],'outer')");
  if (renamed) error.name = "Renamed";
  expect(await run("return [error.message,error.errors[0].name,error.errors[0].message,error.errors[1]]", { bindings: { error } }))
    .toMatchObject({ ok: true, returnValue: ["outer", "TypeError", "member", 7] });
});

it("preserves cyclic members and aliases through public replay", async () => {
  const error = runInNewContext("new AggregateError([],'outer')");
  error.errors.push(error, error);
  const source = "try{await fail()}catch(error){return [error.errors[0]===error,error.errors[0]===error.errors[1]]}";
  const fail = vi.fn(async () => { throw error; });
  const first = await run(source, { bindings: { fail } });
  expect(first).toMatchObject({ ok: true, returnValue: [true, true] });
  const replay = await run(source, { bindings: { fail }, snapshot: JSON.parse(await dump(first)) });
  expect(replay).toMatchObject({ ok: true, returnValue: [true, true] });
  expect(fail).toHaveBeenCalledTimes(1);
});

it.each(["function", "promise"])("rejects foreign aggregate %s capabilities", async kind => {
  const error = runInNewContext("new AggregateError([],'outer')");
  const capability = vi.fn(() => "secret");
  error.errors.push(kind === "function" ? capability : Promise.resolve(capability));
  expect(await run("try{await fail()}catch(error){return [error.name,error.message,typeof error.errors]}", { bindings: { fail: async () => { throw error; } } }))
    .toMatchObject({ ok: true, returnValue: ["TypeError", expect.stringContaining("Host error data"), "undefined"] });
  expect(capability).not.toHaveBeenCalled();
});

it("does not invoke a foreign aggregate errors accessor", async () => {
  const error = runInNewContext("new AggregateError([],'outer')");
  const read = vi.fn(() => { throw new Error("must not read"); });
  Object.defineProperty(error, "errors", { get: read });
  expect(await run("return typeof error.errors", { bindings: { error } }))
    .toMatchObject({ ok: true, returnValue: "undefined" });
  expect(read).not.toHaveBeenCalled();
});

it("copies an own errors payload on native errors without guessing their subtype", async () => {
  const error = Object.assign(new Error("outer"), { errors: [7] });
  expect(await run("return error.errors", { bindings: { error } }))
    .toMatchObject({ ok: true, returnValue: [7] });
});

it("ignores inherited errors payloads without invoking getters", async () => {
  const error = runInNewContext("new AggregateError([],'outer')");
  delete error.errors;
  const read = vi.fn(() => ["secret"]);
  const prototype = Object.create(Object.getPrototypeOf(error));
  Object.defineProperty(prototype, "errors", { get: read });
  Object.setPrototypeOf(error, prototype);
  expect(await run("return typeof error.errors", { bindings: { error } }))
    .toMatchObject({ ok: true, returnValue: "undefined" });
  expect(read).not.toHaveBeenCalled();
});
