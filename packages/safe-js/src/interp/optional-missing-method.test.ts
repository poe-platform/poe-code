import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  "function(){}", "(()=>{})", "(function*(){})()", "(async function*(){})()",
  "[]", "new Map()", "new Set()", "'text'", "7", "true", "1n", "Symbol()"
].flatMap(receiver => ["?.", ""].map(optional => ({ receiver, optional }))))(
  "evaluates absent method calls correctly on $receiver with $optional", async ({receiver,optional}) => {
    const source=`const object=${receiver};let effects=0,value;
      try{value=object.missing${optional}(effects++)}catch(error){value=error.name}
      return [value,effects];`;
    expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext("(()=>{'use strict';"+source+"})()")});
  }
);

it.each(["function(){}", "(function*(){})()"].flatMap(receiver =>
  ["undefined", "null", "7", "function(){return this===object}"].map(value => ({receiver,value}))))(
  "reads method getters before optional arguments on $receiver returning $value", async ({receiver,value}) => {
    const source=`const object=${receiver};const log=[];let result;
      Object.defineProperty(object,'method',{get(){log.push('get');return ${value}}});
      try{result=object.method?.(log.push('argument'))}catch(error){result=error.name}
      return [result,log];`;
    expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext("(()=>{'use strict';"+source+"})()")});
  }
);
