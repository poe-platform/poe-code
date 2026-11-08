import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("concatenates sequentially using the common iterator helper prototype", async () => {
  const result = await run(`const helper=Iterator.concat([1],[2,3],[]);
    return [helper.toArray(),Iterator.concat().toArray(),
      Object.getPrototypeOf(helper)===Object.getPrototypeOf([].values().map(x=>x))]`);
  expect(result).toMatchObject({ok:true,returnValue:[[1,2,3],[],true]});
});

it("captures iterator methods eagerly but opens each input only when needed", async () => {
  const result = await run(`const events=[];
    function input(label){
      return {get [Symbol.iterator](){
        events.push('get '+label);
        return function(){
          events.push('open '+label);let n=0;
          return {get next(){
            events.push('next '+label);
            return function(){events.push('step '+label);return {done:n++>0,value:label}};
          }};
        };
      }};
    }
    const helper=Iterator.concat(input('a'),input('b'));const before=events.slice();
    const first=helper.next();const after=events.slice();const second=helper.next();
    return [before,first,after,second,events]`);
  expect(result).toMatchObject({ok:true,returnValue:[
    ["get a","get b"],{value:"a",done:false},
    ["get a","get b","open a","next a","step a"],{value:"b",done:false},
    ["get a","get b","open a","next a","step a","step a","open b","next b","step b"]
  ]});
});

it.each(["null","undefined","1","true","'text'","Symbol()","{}","{[Symbol.iterator]:1}"])(
  "rejects invalid input %s during construction", async input => {
    expect(await run(`try{Iterator.concat(${input});return 'accepted'}catch(e){return [typeof Iterator.concat,e.name]}`))
      .toMatchObject({ok:true,returnValue:["function","TypeError"]});
  }
);

it.each([false,true])("closes only an opened iterator on return (opened=%s)", async opened => {
  const result = await run(`const events=[];
    function input(label){
      return {[Symbol.iterator](){
        events.push('open '+label);
        return {
          next(){return {value:1,done:false}},
          return(){events.push('close '+label);return {done:true}}
        };
      }};
    }
    const helper=Iterator.concat(input('a'),input('b'));${opened ? "helper.next();" : ""}
    const result=helper.return();return [events,result,helper.next()]`);
  expect(result).toMatchObject({ok:true,returnValue:[opened?["open a","close a"]:[],
    {value:undefined,done:true},{value:undefined,done:true}]});
});

it("preserves captured open methods after the source property changes", async () => {
  expect(await run(`const input={[Symbol.iterator](){return [7].values()}};
    const helper=Iterator.concat(input);input[Symbol.iterator]=()=>[9].values();return helper.toArray()`))
    .toMatchObject({ok:true,returnValue:[7]});
});

it("exposes nonconstructible concat metadata", async () => {
  expect(await run(`const d=Object.getOwnPropertyDescriptor(Iterator,'concat');let error;
    try{new Iterator.concat()}catch(e){error=e.name}
    return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable,error]`))
    .toMatchObject({ok:true,returnValue:["concat",0,true,false,true,"TypeError"]});
});

it("preserves the current input and remaining inputs across public replay", async () => {
  const source=`const helper=Iterator.concat([1,2],[3]);const first=helper.next();
    await 0;return [first,helper.toArray()]`;
  const original=await run(source);
  expect(original).toMatchObject({ok:true,returnValue:[{value:1,done:false},[2,3]]});
  const replayed=await run(source,{snapshot:JSON.parse(await dump(original))});
  expect(replayed).toMatchObject({ok:true,returnValue:[{value:1,done:false},[2,3]]});
});

it.each(["open","next getter","next call","done","value"])(
  "finishes without closing inputs when %s throws during advancement", async failure => {
    const result=await run(`const events=[];const reason={};const phase=${JSON.stringify(failure)};
      const cursor={get next(){if(phase==='next getter')throw reason;return function(){
        if(phase==='next call')throw reason;
        return {get done(){if(phase==='done')throw reason;return false},get value(){throw reason}};
      }},return(){events.push('close');return {done:true}}};
      const input={[Symbol.iterator](){events.push('open');if(phase==='open')throw reason;return cursor}};
      const later={[Symbol.iterator](){events.push('later');return cursor}};
      const helper=Iterator.concat(input,later);let same=false;
      try{helper.next()}catch(e){same=e===reason}
      return [same,events,helper.next(),helper.return()]`);
    expect(result).toMatchObject({ok:true,returnValue:[true,["open"],
      {value:undefined,done:true},{value:undefined,done:true}]});
  }
);

it("rejects reentrant advancement without completing the outer next call", async () => {
  expect(await run(`let helper;const errors=[];const input={[Symbol.iterator](){return {next(){
    try{helper.next()}catch(e){errors.push(e.name)}
    try{helper.return()}catch(e){errors.push(e.name)}
    return {value:7,done:false}
  }}}};helper=Iterator.concat(input);return [helper.next(),errors]`))
    .toMatchObject({ok:true,returnValue:[{value:7,done:false},["TypeError","TypeError"]]});
});
