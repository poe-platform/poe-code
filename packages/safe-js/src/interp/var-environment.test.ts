import { describe, expect, it } from "vitest";

import { dump } from "../dump.js";
import { run } from "../run.js";

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;

describe("function var environments", () => {
  it.each([
    "let get; function read({ [(get = () => value, 'value')]: value }) { var value = 2; return [value, get()]; } return read({ value: 42 });",
    "function read({ value = 1 } = {}, get = () => value) { var value = 2; return [value, get()]; } return read();",
    "function read(value = 1, get = () => value) { const original = get; var get = () => value; var value = 2; return [original(), get()]; } return read();",
    "async function read(value = 1, get = () => value) { await 0; var value = 2; return [value, get()]; } return await read();",
    "function* read(value = 1, get = () => value) { var value = 2; yield value; yield get(); } return Array.from(read());",
    "function read(value) { var value; return value; } return read(42);",
    "function read(value) { var value = 7; return value; } return read(42);",
    "function read(value) { const get = () => value; var value = 7; return [value, get()]; } return read(42);",
    "function read({ value }) { var value; return value; } return read({ value: 42 });",
    "function read([value]) { var value = 7; return value; } return read([42]);",
    "function read(...values) { var values; return values; } return read(1, 2);",
    "function read(value = 1, get = () => value) { var value = 2; return [value, get()]; } return read();",
    "function read(value = 1, get = () => value) { value = 2; return [value, get()]; } return read();",
    "function read(value = 1, get = () => value) { var value; return [value, get()]; } return read(42);",
    "let value = 1; function read(get = () => value) { var value = 2; return [value, get()]; } return read();",
    "function read(value = 1, get = () => value) { { var value = 2; } return [value, get()]; } return read();",
    "function read(value = () => arguments[1]) { var value; return value(); } return read(undefined, 42);",
    "function read(value = arguments[0]) { var value; return [value, arguments.length]; } return read(undefined, 42);",
    "function read(value) { function value() { return 1; } const before = value(); value = 2; return [before, value]; } return read(42);",
    "function read() { function value() { return 1; } function value() { return 2; } return value(); } return read();",
    "function read(value) { { let value = 2; value++; } return value; } return read(42);",
    "async function read(value) { var value; await 0; return value; } return await read(42);",
    "function* read(value) { var value; yield value; } return Array.from(read(42));"
  ])("matches native execution and replay: %s", async (source) => {
    const expected = await new AsyncFunction(`"use strict"; ${source}`)();
    const result = await run(source);
    expect(result).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot: JSON.parse(await dump(result)) })).toMatchObject({
      ok: true,
      returnValue: expected
    });
  });
});
