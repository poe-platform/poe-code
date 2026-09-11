import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["NumberFormat", "new Intl.NumberFormat('en-US').format(value)", "42"],
  ["Collator", "new Intl.Collator('en-US').compare(value,'z')", -1]
])("preserves guest proxy access in cached %s functions", async (name, expression, expected) => {
  expect(await run(`const value=new Proxy({}, {get(t,k){
    if(k===Symbol.toPrimitive)return ()=>${name === "NumberFormat" ? "42" : "'a'"};
  }});return ${expression};`)).toMatchObject({ok:true,returnValue:expected});
});

it("retains cached formatter proxy coercion after completed replay", async () => {
  const source=`const format=new Intl.DateTimeFormat('en-US',{year:'numeric',timeZone:'UTC'}).format;
    const value=new Proxy({}, {get(t,k){if(k===Symbol.toPrimitive)return ()=>0}});
    await 0;return format(value);`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:"1970"});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))}))
    .toMatchObject({ok:true,returnValue:"1970"});
});

it("coerces a proxy without giving it its target's ZonedDateTime brand", async () => {
  expect(await run(`const log=[];const value=new Proxy(new Temporal.ZonedDateTime(0n,'UTC'),{
    get(t,k){log.push(String(k));if(k===Symbol.toPrimitive)return ()=>0}
  });return [new Intl.DateTimeFormat('en-US',{year:'numeric',timeZone:'UTC'}).format(value),log];`))
    .toMatchObject({ok:true,returnValue:["1970",["Symbol(Symbol.toPrimitive)"]]});
});
