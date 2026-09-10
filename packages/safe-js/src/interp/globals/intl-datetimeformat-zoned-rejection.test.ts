import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["format", "formatToParts", "formatRange", "formatRangeToParts"])(
  "%s rejects an owned ZonedDateTime before primitive coercion", async (method) => {
    expect(await run(`const value=new Temporal.ZonedDateTime(0n,'UTC'),log=[];
      value.valueOf=()=>{log.push('valueOf');return 0};let error;
      try{new Intl.DateTimeFormat('en-US')[${JSON.stringify(method)}](value,value)}catch(e){error=e.name}
      return [error,log];`)).toMatchObject({ok:true,returnValue:["TypeError",[]]});
  }
);

it.each(["formatRange", "formatRangeToParts"])("%s converts the other range operand before rejecting a ZonedDateTime", async (method) => {
  expect(await run(`const formatter=new Intl.DateTimeFormat('en-US'),log=[];
    const zoned=new Temporal.ZonedDateTime(0n,'UTC');zoned.valueOf=()=>{log.push('zoned');return 0};
    const number={valueOf(){log.push('number');return 0}};const errors=[];
    try{formatter[${JSON.stringify(method)}](zoned,number)}catch(e){errors.push(e.name)}
    const first=log.slice();log.length=0;
    try{formatter[${JSON.stringify(method)}](number,zoned)}catch(e){errors.push(e.name)}
    return [errors,first,log];`))
    .toMatchObject({ok:true,returnValue:[["TypeError","TypeError"],["number"],["number"]]});
});
