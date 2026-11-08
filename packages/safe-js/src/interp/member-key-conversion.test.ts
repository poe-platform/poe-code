import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../core.js";
import { Budget } from "./budget.js";

const assignments = ["+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^=", "&&=", "||=", "??="];

// ECMAScript 2026, 6.2.5.5 GetValue and 6.2.5.6 PutValue: GetValue stores
// the converted ReferencedName; PutValue reuses it. Node v22 converts raw
// object-valued keys twice for some operators, so it is NOT that oracle.
describe("member writes reuse the converted reference key", () => {
  it.each([
    {
      name: "a hook changed by the RHS",
      source: "const seen=[];const key={toString(){seen.push('first');return 'x'}};const o={x:2,y:19};function rhs(){seen.push('rhs');key.toString=()=>{seen.push('second');return 'y'};return 3}o[key]+=rhs();return [o.x,o.y,seen]",
      expected: [5, 19, ["first", "rhs"]]
    },
    {
      name: "an effectful key expression and hook",
      source: "const seen=[];let calls=0;const key={toString(){seen.push('key');return ++calls===1?'x':'y'}};const o={x:2,y:19};function ref(){seen.push('expression');return key}o[ref()]+=3;return [o.x,o.y,seen]",
      expected: [5, 19, ["expression", "key"]]
    },
    {
      name: "a primitive key binding changed by the RHS",
      source: "let key='x';const o={x:2,y:19};o[key]+=(key='y',3);return [o.x,o.y]",
      expected: [5, 19]
    },
    {
      name: "an array key mutated by the RHS",
      source: "const key=[0];const o=[2,19];o[key]+=(key[0]=1,3);return o",
      expected: [5, 19]
    },
    {
      name: "a receiver binding replaced by the RHS",
      source: "let o={x:2};const original=o;const key={toString(){return 'x'}};o[key]+=(o={x:19},3);return [original.x,o.x]",
      expected: [5, 19]
    },
    {
      name: "a hook changed during numeric coercion",
      source: "const seen=[];const key={toString(){seen.push('first');return 'x'}};const o={x:{valueOf(){seen.push('value');key.toString=()=>{seen.push('second');return 'y'};return 2}},y:19};const result=o[key]++;return [result,o.x,o.y,seen]",
      expected: [2, 3, 19, ["first", "value"]]
    }
  ])("preserves the captured reference with $name", async ({ source, expected }) => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(assignments.flatMap(operator => [0, 2, null].map(initial => ({ operator, initial }))))(
    "coerces once for $operator with initial value $initial", async ({ operator, initial }) => {
      // Use a fixed primitive key only to obtain arithmetic and short-circuit
      // results. The object-key conversion count is specified independently.
      const control = `const o={x:${initial},y:19};const seen=[];function rhs(){seen.push('rhs');return 3}
        const result=o.x${operator}rhs();return [result,o.x,o.y,1,['key',...seen]]`;
      const source = `const seen=[];let calls=0;const key={toString(){seen.push('key');return ++calls===1?'x':'y'}};
        const o={x:${initial},y:19};function rhs(){seen.push('rhs');return 3}
        const result=o[key]${operator}rhs();return [result,o.x,o.y,calls,seen]`;
      const expected = runInNewContext(`(()=>{'use strict';${control}})()`);
      expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it.each([
    ["o[key]++", [1, 2, 19, 1]],
    ["++o[key]", [2, 2, 19, 1]],
    ["o[key]--", [1, 0, 19, 1]],
    ["--o[key]", [0, 0, 19, 1]],
    ["o[key]=3", [3, 3, 19, 1]],
    ["delete o[key]", [true, undefined, 19, 1]]
  ])("coerces once for %s", async (expression, expected) => {
    expect(await run(`let calls=0;const key={toString(){return ++calls===1?'x':'y'}};
      const o={x:1,y:19};const result=${expression};return [result,o.x,o.y,calls]`
    )).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "({x:''})[key]+='b'.repeat(2000)",
    "({x:true})[key]&&='b'.repeat(2000)",
    "({x:false})[key]||='b'.repeat(2000)",
    "({x:null})[key]??='b'.repeat(2000)",
    "({payload:'b'.repeat(2000),x:1})[key]++",
    "++({payload:'b'.repeat(2000),x:1})[key]"
  ])("does not run a second allocating or throwing hook: %s", async expression => {
    const budget = new Budget({ dataSize: 6000 });
    const source = `let calls=0;const key={toString(){if(++calls===1)return 'x';const temporary='y'.repeat(5000);throw 'second'}};
      ${expression};return calls`;
    expect(await run(source, { budget })).toMatchObject({ ok: true, returnValue: 1 });
    expect([...budget.retainedValues()]).toEqual([]);
  });
});
