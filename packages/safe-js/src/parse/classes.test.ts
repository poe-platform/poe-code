import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { parseModule } from "./parser.js";

describe("class parser", () => {
  it.each([
    'class C {}',
    'class C extends Parent { constructor(value) { super(value); } read() { return super.read(); } }',
    'class C { static value = 7; value = 8; static { this.value++; } }',
    'class C { value = () => { return 7; }; }',
    'class C { value = async () => await 7; }',
    'class C { value = function () { return arguments[0]; }; }',
    'class C { static { function read() { return arguments[0]; } } }',
    'class C { read() { return `${super.value}:${new.target}`; } }',
    'class C { read() { return () => super.value; } }',
    'class C extends Parent { constructor() { const start = () => super(); start(); } }',
    'class C { *values() { yield 7; } async read() { return await 7; } }',
    'class C { constructor(value = new.target) { this.value = value; } }',
    'class C { read() { delete super.value; } }'
  ])("parses valid class syntax: %s", (source) => {
    expect(() => new Script(source)).not.toThrow();
    expect(parseModule(source).body[0]?.type).toBe("ClassDeclaration");
  });

  it.each([
    'class {}',
    'class C { constructor() {} constructor() {} }',
    'class C { async constructor() {} }',
    'class C { *constructor() {} }',
    'class C { constructor = 7; }',
    'class C { static prototype() {} }',
    'class C { static { return; } }',
    'class C { value = arguments; }',
    'class C { value = () => arguments; }',
    'class C { value = `${arguments}`; }',
    'class C { static { arguments; } }',
    'class C { value = await 7; }',
    'class C { static { await 7; } }',
    'class C { read() { await 7; } }',
    'class C { async read() { return () => await 7; } }',
    'class C { read() { return function () { return super.value; }; } }',
    'class C extends Parent { constructor() { function start() { super(); } } }',
    'class C { read() { super(); } }',
    'class C { constructor() { super(); } }',
    'class C extends Parent { constructor() { new super(); } }',
    'class C { read() { super?.value; } }',
    'class C { read() { return super; } }',
    'class C { read() { new.target = 7; } }',
    '() => new.target'
  ])("rejects native early errors: %s", (source) => {
    expect(() => new Script(source)).toThrow();
    expect(() => parseModule(source)).toThrow();
  });
});
