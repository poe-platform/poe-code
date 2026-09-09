import { expect, it } from "vitest";
import { run } from "../run.js";

for (const copy of [
  'return {...source}',
  'const {...rest}=source;return rest',
  'let rest;({...rest}=source);return rest',
  'function copy({...rest}){return rest}return copy(source)'
]) {
  it.each([
    { name: "newly enumerable string", setup: 'Object.defineProperty(source,"b",{value:2,configurable:true});', mutation: 'Object.defineProperty(source,"b",{enumerable:true})', result: copy },
    { name: "newly enumerable symbol", setup: 'Object.defineProperty(source,key,{value:2,configurable:true});', mutation: 'Object.defineProperty(source,key,{enumerable:true})', result: `const result=(()=>{${copy}})();return [result.a,result[key]]` },
    { name: "new key excluded", setup: '', mutation: 'source.b=2', result: copy },
    { name: "deleted key excluded", setup: 'source.b=2;', mutation: 'delete source.b', result: copy },
    { name: "newly hidden key excluded", setup: 'source.b=2;', mutation: 'Object.defineProperty(source,"b",{enumerable:false})', result: copy }
  ])(`${copy}: $name`, async ({ setup, mutation, result }) => {
    const source = `const key=Symbol("b");const source={get a(){${mutation};return 1}};${setup}${result}`;
    const expected = Function(source)();
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
}
