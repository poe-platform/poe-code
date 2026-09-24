import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "./run.js";

describe("public run match-array metadata", () => {
  it("retains the reported non-ASCII exec offset in an exported function", async () => {
    const result = await run(`export default () => {
      const m = /needle/i.exec("İ before NEEDLE");
      return { value: m[0], index: m.index };
    };`, { entryPointArgs: [] });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.returnValue)).toBe('{"value":"NEEDLE","index":9}');
  });

  it.each([
    'return /needle/i.exec("İ before NEEDLE");',
    'return /(?<word>needle)(?<optional>x)?/i.exec("😀 İ NEEDLE");',
    'const re=/needle/gi; const text="İ NEEDLE 😀 needle"; const a=re.exec(text); const b=re.exec(text); const c=re.exec(text); return [a,b,c,re.lastIndex];',
    'const re=/needle/i; return [re.exec("İ NEEDLE"),re.exec("İ NEEDLE"),re.lastIndex];',
    'return /needle/i.exec("İ absent");',
    'return "İ before NEEDLE".match(/needle/i);',
    'return "😀 İ NEEDLE".match(/(?<word>needle)(?<optional>x)?/i);',
    'return "İ NEEDLE 😀 needle".match(/needle/gi);',
    'return "İ absent".match(/needle/gi);',
    'return ["İ before NEEDLE".search(/needle/i),"😀 NEEDLE".search(/needle/i),"İ absent".search(/needle/i)];'
  ])("agrees with native JavaScript: %s", async source => {
    const expected = runInNewContext(`(function(){${source}})()`);
    const result = await run(source);
    expect(result.ok).toBe(true);
    expect(result.returnValue).toEqual(expected);
  });

  it.each([
    '/needle/i.exec(text)',
    'text.match(/needle/i)',
    '/(?<word>needle)(?<optional>x)?/i.exec(text)',
    'text.match(/(?<word>needle)(?<optional>x)?/i)'
  ])("exposes metadata inside the interpreter: %s", async expression => {
    const source = `const text="İ before NEEDLE"; const m=${expression};
      return [m[0],m.index,m.input,m.groups,m.groups?.word,m.groups?.optional,Object.hasOwn(m,"groups"),Object.keys(m)];`;
    expect((await run(source)).returnValue).toEqual(runInNewContext(`(function(){${source}})()`));
  });
});
