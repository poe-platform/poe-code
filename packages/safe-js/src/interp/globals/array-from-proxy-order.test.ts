import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

for (const receiver of ["proxy", "Object.create(proxy)"]) {
  it.each(["normal", "throw", "replace"])(`Array.from captures ${receiver} iterator before %s construction`, async mode => {
    const source = `
      const events=[];
      let factory=function(){events.push(['factory',this===items]);return {next(){return {done:true}}}};
      const proxy=new Proxy({}, {get(target,key,receiver){
        if(key===Symbol.iterator){events.push('get');return factory}
        return Reflect.get(target,key,receiver);
      }});
      const items=${receiver};
      function C(){
        events.push('construct');
        ${mode === "throw" ? "throw 'construction failed';" : ""}
        ${mode === "replace" ? "factory=function(){events.push('replacement');throw 'wrong factory'};" : ""}
      }
      try{Array.from.call(C,items)}catch(error){events.push(error)}
      return events;
    `;
    const expected = mode === "throw"
      ? ["get", "construct", "construction failed"]
      : ["get", "construct", ["factory", true]];
    expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["undefined", "null", "42"])(`Array.from validates ${receiver} iterator %s before construction`, async iterator => {
    const source = `
      const events=[];
      const proxy=new Proxy({}, {get(target,key){
        if(key===Symbol.iterator){events.push('get');return ${iterator}}
        if(key==='length'){events.push('length');return 0}
        return Reflect.get(target,key);
      }});
      function C(){events.push('construct')}
      try{Array.from.call(C,${receiver})}catch(error){events.push(error.name)}
      return events;
    `;
    const expected = iterator === "42" ? ["get", "TypeError"] : ["get", "length", "construct"];
    expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
}
