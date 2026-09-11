import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

const loops=["in", "of", "await of"];
const declarations=["let", "const", "var"];

it.each(loops.flatMap(loop=>declarations.map(declaration=>({loop,declaration}))))(
  "checks header bindings before RHS reads: $declaration $loop", async ({loop,declaration})=>{
    const source=`var x='outside';const result=[];
      try{for ${loop==='await of'?'await ':''}(${declaration} x ${loop==='in'?'in':'of'} ${loop==='in'?'{x}':'[x]'})result.push(x)}catch(error){result.push(error.name)}
      return result;`;
    expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext("(async()=>{'use strict';"+source+"})()")});
  }
);

it.each(loops.flatMap(loop=>["let", "const"].map(declaration=>({loop,declaration}))))(
  "keeps RHS closure bindings separate from iterations: $declaration $loop", async ({loop,declaration})=>{
    const source=`let x='outside';let probe;const result=[];
      for ${loop==='await of'?'await ':''}(${declaration} x ${loop==='in'?'in':'of'} (probe=()=>typeof x,${loop==='in'?'{a:1,b:2}':'["a","b"]'}))result.push(()=>x);
      let captured;try{captured=probe()}catch(error){captured=error.name}
      return [x,captured,result.map(fn=>fn())];`;
    expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext("(async()=>{'use strict';"+source+"})()")});
  }
);

it.each(loops)("predeclares every destructured header name: %s", async loop=>{
  const source=`let x='outside',y='outside';let probe;
    for ${loop==='await of'?'await ':''}(let [x,y] ${loop==='in'?'in':'of'} (probe=()=>typeof y,${loop==='in'?'{ab:1}':'[[1,2]]'})){}
    try{return probe()}catch(error){return error.name}`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext("(async()=>{'use strict';"+source+"})()")});
});

it.each(loops)("keeps the outer scope when a header has no bound names: %s", async loop=>{
  const source=`let x='outside';let probe;
    for ${loop==='await of'?'await ':''}(let {} ${loop==='in'?'in':'of'} (probe=()=>x,${loop==='in'?'{a:1}':'[{}]'})){}
    return probe();`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:await runInNewContext("(async()=>{'use strict';"+source+"})()")});
});
