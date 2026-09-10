import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

for (const expression of [
  "new Map()", "new Set()", "Promise.resolve(1)", "(function*(){})()",
  "/a/", "new Date(0)", "new Number(1)", "function(){}"
]) {
  it.each(["replace", "delete"])(`JSON reviver can %s properties of inserted ${expression}`, async operation => {
    const source = `
      const object=${expression};object.a=1;
      const events=[];
      JSON.parse('["seed",null]',function(key,value){
        if(value==='seed')this[1]=object;
        if(key==='a'){events.push(value);return ${operation === "delete" ? "undefined" : "2"}}
        return value;
      });
      return [events,Object.hasOwn(object,'a'),object.a];
    `;
    const expected = operation === "delete" ? [[1], false, undefined] : [[1], true, 2];
    expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
}

it.each(["Uint8Array", "BigInt64Array"])("JSON reviver converts replacement elements of inserted %s", async type => {
  const source = `
    const events=[];const object=new ${type}(1);
    JSON.parse('["seed",null]',function(key,value){
      if(value==='seed')this[1]=object;
      if(this===object)return {valueOf(){events.push('convert');return ${type === "Uint8Array" ? "257" : "257n"}}};
      return value;
    });
    return [events,String(object[0])];
  `;
  const expected = [["convert"], type === "Uint8Array" ? "1" : "257"];
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});
