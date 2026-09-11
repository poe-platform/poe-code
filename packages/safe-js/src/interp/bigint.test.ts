import { describe, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

describe("BigInt language integration", () => {
  it.each([
    "return [0n, 123n, 9_007_199_254_740_993n, 0xffn, 0b101n, 0o77n];",
    "return [17n+5n,17n-5n,17n*5n,17n/5n,-17n%5n,2n**10n];",
    "return [~5n,5n&3n,5n|3n,5n^3n,5n<<2n,-5n>>1n,8n<<-1n];",
    "let x=3n;const before=x++;const after=--x;x*=2n;return [before,after,x];",
    "return [typeof 1n,!0n,!1n,1n===1,1n==1,1n=='1',2n<2.5,9007199254740993n>9007199254740992];",
    "return [BigInt('9007199254740993'),BigInt(true),BigInt(12),BigInt('0xff'),BigInt(''),Number(3n),String(3n)];",
    "return [BigInt.asIntN(8,255n),BigInt.asUintN(8,-1n),(255n).toString(16),(1n).valueOf()];",
    "const x=Object(3n);return [x.valueOf(),x.toString(),Object.prototype.toString.call(x),Object.getPrototypeOf(x)===BigInt.prototype];",
    "const x={ [Symbol.toPrimitive](hint){return hint==='string'?'key':2n} };return [x+3n,x*3n,`${x}`];",
    "const x={};x[2n]='two';return [x['2'],[1n,2n].join('-'),'x'+3n];",
    "const m=new Map([[1n,'big'],[1,'number']]);return [m.size,m.get(1n),new Set([1n,1,1n]).size];",
    "return JSON.stringify({value:2n},(key,value)=>typeof value==='bigint'?String(value):value);"
  ])("matches native JavaScript: %s", async source => {
    // Only fixed, repository-owned programs are evaluated by the native oracle.
    const expected: unknown = Function('"use strict";'+source)();
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["1n+1", "1n*1", "+1n", "1n>>>1n", "1n/0n", "2n**-1n", "BigInt(1.5)", "BigInt(null)", "BigInt('1.5')", "new BigInt(1)", "Math.abs(1n)", "JSON.stringify(1n)"])("preserves errors: %s", async expression => {
    const source=`try{${expression};return 'no error'}catch(error){return error.name}`;
    const expected: unknown = Function('"use strict";'+source)();
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("admits exact host BigInt bindings without converting to Number", async () => {
    expect(await run("return input", { bindings: { input: 9007199254740993n } }))
      .toMatchObject({ ok: true, returnValue: 9007199254740993n });
  });

  it("preserves BigInts through JSON checkpoint transport and replay", async () => {
    const source="const value=9007199254740993n;await 0;return [value,value+2n];";
    const pending=run(source);
    const completed=pending.catch(error=>error);
    try {
      const snapshot=restore(JSON.parse(await dump(pending)),{source});
      const expected={ok:true,returnValue:[9007199254740993n,9007199254740995n]};
      expect(await completed).toMatchObject(expected);
      expect(await run(source,{snapshot})).toMatchObject(expected);
    } finally { await completed; }
  });
});
