import { expect, it } from "vitest";
import { run } from "../../run.js";

for (const method of ["values", "entries"]) {
  it.each([
    { name: "newly enumerable existing key", setup: 'Object.defineProperty(target,"b",{value:2,configurable:true});', mutation: 'Object.defineProperty(target,"b",{enumerable:true})' },
    { name: "newly hidden key", setup: 'target.b=2;', mutation: 'Object.defineProperty(target,"b",{enumerable:false})' },
    { name: "deleted key", setup: 'target.b=2;', mutation: 'delete target.b' },
    { name: "new key is excluded", setup: '', mutation: 'target.b=2' },
    { name: "symbol key is excluded", setup: '', mutation: 'target[Symbol("b")]=2' }
  ])(`Object.${method}: $name`, async ({ setup, mutation }) => {
    const source = `const target={get a(){${mutation};return 1}};${setup}return Object.${method}(target)`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: Function(source)() });
  });
}
