import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(["zip", "zipKeyed"])("replays %s through the public dump/run interface", async method => {
  const inputs=method === "zip" ? "[[1],[2,3]]" : "{a:[1],b:[2,3]}";
  const source=`const helper=Iterator.${method}(${inputs},{mode:'longest'});
    const first=helper.next();await 0;return [first,helper.toArray()]`;
  const original=await run(source);
  expect(original.ok).toBe(true);
  const replayed=await run(source,{snapshot:JSON.parse(await dump(original))});
  expect(replayed).toMatchObject({ok:true,returnValue:original.returnValue});
});

it("rejects reentrant next and return without completing the active operation", async () => {
  expect(await run(`let helper;const errors=[];const input={next(){
    try{helper.next()}catch(e){errors.push(e.name)}
    try{helper.return()}catch(e){errors.push(e.name)}
    return {value:7,done:false}
  }};helper=Iterator.zip([input]);return [helper.next(),errors]`))
    .toMatchObject({ok:true,returnValue:[{value:[7],done:false},["TypeError","TypeError"]]});
});

it.each(["next","done","value"])("does not close a cursor whose %s operation throws", async phase => {
  expect(await run(`const events=[];const reason={};const phase=${JSON.stringify(phase)};
    const a={next(){if(phase==='next')throw reason;return {
      get done(){if(phase==='done')throw reason;return false},get value(){throw reason}}},
      return(){events.push('a');return {done:true}}};
    const b={next(){return {done:false,value:2}},return(){events.push('b');throw 'other'}};
    const helper=Iterator.zip([a,b]);let same=false;try{helper.next()}catch(e){same=e===reason}
    return [same,events,helper.next()]`))
    .toMatchObject({ok:true,returnValue:[true,["b"],{value:undefined,done:true}]});
});

it.each([
  ["Iterator.zip([[1,2],[3]])",[[1,3]]],
  ["Iterator.zip([[1],[2,3]],{mode:'longest',padding:[0,9]})",[[1,2],[0,3]]],
  ["Iterator.zip([[1,2],[3,4]],{mode:'strict'})",[[1,3],[2,4]]]
])("implements joint iteration values: %s", async (expression,expected) => {
  expect(await run(`return ${expression}.toArray()`)).toMatchObject({ok:true,returnValue:expected});
});

it.each(["shortest","longest","strict"])("handles empty inputs in %s mode", async mode => {
  expect(await run(`return [Iterator.zip([],{mode:${JSON.stringify(mode)}}).toArray(),
    Iterator.zipKeyed({},{mode:${JSON.stringify(mode)}}).toArray()]`))
    .toMatchObject({ok:true,returnValue:[[],[]]});
});

it("creates null-prototype keyed rows with enumerable own string and symbol keys", async () => {
  expect(await run(`const key=Symbol('s');const inputs={a:[1],ignored:undefined,[key]:[3]};
    Object.defineProperty(inputs,'__proto__',{value:[2],enumerable:true});
    Object.defineProperty(inputs,'hidden',{get(){throw 'hidden'},enumerable:false});
    const row=Iterator.zipKeyed(inputs).next().value;
    return [Object.getPrototypeOf(row)===null,Reflect.ownKeys(row).map(String),row.a,row.__proto__,row[key]]`))
    .toMatchObject({ok:true,returnValue:[true,["a","__proto__","Symbol(s)"],1,2,3]});
});

it("uses keyed padding only for exhausted inputs", async () => {
  expect(await run(`return Iterator.zipKeyed({a:[1],b:[2,3]},{mode:'longest',padding:{a:0}})
    .map(row=>[row.a,row.b]).toArray()`))
    .toMatchObject({ok:true,returnValue:[[1,2],[0,3]]});
});

it.each(["zip","zipKeyed"])("exposes %s metadata and the shared helper prototype", async method => {
  expect(await run(`const d=Object.getOwnPropertyDescriptor(Iterator,${JSON.stringify(method)});
    const helper=d.value(${method==="zip"?"[]":"{}"});let error;
    try{new d.value()}catch(e){error=e.name}
    return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable,error,
      Object.getPrototypeOf(helper)===Object.getPrototypeOf([].values().map(x=>x))]`))
    .toMatchObject({ok:true,returnValue:[method,1,true,false,true,"TypeError",true]});
});

it.each(["null","undefined","1","'text'","[] , null","[], {mode:'invalid'}","[], {mode:1}",
  "[], {mode:{toString(){throw 'coercion'}}}","[], {mode:'longest',padding:1}"])(
  "rejects invalid zip arguments: %s", async argumentsSource => {
    expect(await run(`try{Iterator.zip(${argumentsSource});return 'accepted'}catch(e){return [typeof Iterator.zip,e.name]}`))
      .toMatchObject({ok:true,returnValue:["function","TypeError"]});
  }
);

const tracedInputs=`const events=[];
  function input(label,done){return {[Symbol.iterator](){
    events.push('open '+label);
    return {next(){events.push('next '+label);return {done,value:label}},
      return(){events.push('close '+label);return {done:true}}};
  }}};
`;

it("does not retry close methods after shortest-mode cleanup throws", async () => {
  expect(await run(`const events=[];const helper=Iterator.zip([
    {next(){return {done:true}}},
    {next(){return {done:false}},return(){events.push('close');throw 'failure'}}]);
    let error;try{helper.next()}catch(e){error=e}return [error,events,helper.next()]`))
    .toMatchObject({ok:true,returnValue:["failure",["close"],{value:undefined,done:true}]});
});

it("observes keyed proxy enumeration and property access in order", async () => {
  expect(await run(`const events=[];const inputs=new Proxy({a:[1],b:[2]}, {
    ownKeys(target){events.push('keys');return ['b','a']},
    getOwnPropertyDescriptor(target,key){events.push('descriptor '+key);return Reflect.getOwnPropertyDescriptor(target,key)},
    get(target,key){events.push('get '+key);return target[key]}
  });const row=Iterator.zipKeyed(inputs).next().value;return [events,Reflect.ownKeys(row),row.b,row.a]`))
    .toMatchObject({ok:true,returnValue:[["keys","descriptor b","get b","descriptor a","get a"],["b","a"],2,1]});
});

it("opens inputs eagerly and closes all of them in reverse order before first next", async () => {
  expect(await run(tracedInputs+`const helper=Iterator.zip([input('a',false),input('b',false),input('c',false)]);
    const result=helper.return();return [events,result,helper.next()]`))
    .toMatchObject({ok:true,returnValue:[
      ["open a","open b","open c","close c","close b","close a"],
      {value:undefined,done:true},{value:undefined,done:true}
    ]});
});

it("shortest mode stops at the first exhausted input and closes the others", async () => {
  expect(await run(tracedInputs+`const helper=Iterator.zip([input('a',true),input('b',false),input('c',false)]);
    return [helper.next(),events]`))
    .toMatchObject({ok:true,returnValue:[{value:undefined,done:true},
      ["open a","open b","open c","next a","close c","close b"]]});
});

it("strict mode checks remaining done flags without reading their values", async () => {
  expect(await run(`const events=[];const first={next(){events.push('first');return {done:true}}};
    const second={next(){events.push('second');return {done:false,get value(){throw 'value'}}},
      return(){events.push('close');return {done:true}}};
    const helper=Iterator.zip([first,second],{mode:'strict'});let error;
    try{helper.next()}catch(e){error=e.name}return [error,events,helper.next()]`))
    .toMatchObject({ok:true,returnValue:["TypeError",["first","second","close"],{value:undefined,done:true}]});
});

it("closes earlier inputs before the outer iterator on acquisition failure", async () => {
  expect(await run(`const events=[];const first={next(){return {done:false,value:1}},
    return(){events.push('inner');return {done:true}}};let index=0;
    const inputs={[Symbol.iterator](){return {next(){return {done:false,value:index++===0?first:7}},
      return(){events.push('outer');return {done:true}}}}};
    let error;try{Iterator.zip(inputs)}catch(e){error=e.name}
    return [typeof Iterator.zip,error,events]`))
    .toMatchObject({ok:true,returnValue:["function","TypeError",["inner","outer"]]});
});

it("continues reverse closing and preserves the first close error", async () => {
  expect(await run(`const events=[];const aError={};const bError={};
    const a={next(){return {done:false,value:1}},return(){events.push('a');throw aError}};
    const b={next(){return {done:false,value:2}},return(){events.push('b');throw bError}};
    const helper=Iterator.zip([a,b]);let same=false;
    try{helper.return()}catch(e){same=e===bError}
    return [same,events,helper.next()]`))
    .toMatchObject({ok:true,returnValue:[true,["b","a"],{value:undefined,done:true}]});
});

it("consumes only one padding value per input and closes the padding iterator", async () => {
  expect(await run(`const events=[];const padding={[Symbol.iterator](){let index=0;return {
    next(){events.push('next');return {value:++index,done:false}},
    return(){events.push('return');return {done:true}}
  }}};const helper=Iterator.zip([[1],[2]],{mode:'longest',padding});
    return [events,helper.toArray()]`))
    .toMatchObject({ok:true,returnValue:[["next","next","return"],[[1,2]]]});
});
