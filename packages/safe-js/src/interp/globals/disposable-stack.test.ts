import { expect, it } from "vitest";
import { run } from "../../run.js";

it("captures disposers at registration and cleans up in reverse order", async () => {
  expect(await run(`
    const calls=[]; const stack=new DisposableStack();
    const resource={get [Symbol.dispose](){calls.push('get');return function(){calls.push(this===resource)}}};
    const same=stack.use(resource)===resource;
    Object.defineProperty(resource,Symbol.dispose,{value:()=>calls.push('wrong')});
    const adopted=stack.adopt(7,function(value){calls.push([value,this===undefined,arguments.length])});
    const deferred=stack.defer(function(){calls.push(['defer',this===undefined,arguments.length])});
    stack.dispose(); stack.dispose();
    return [same,adopted,deferred,stack.disposed,calls];
  `)).toMatchObject({ok:true,returnValue:[true,7,undefined,true,['get',['defer',true,0],[7,true,1],true]]});
});

it("moves ownership into an intrinsic stack without consulting subclass constructors", async () => {
  expect(await run(`
    let count=0; class Child extends DisposableStack {};
    const original=new Child(); original.defer(()=>count++);
    Object.defineProperty(original,'constructor',{get(){throw 'wrong'}});
    const moved=original.move(); original.dispose();
    const before=[original.disposed,moved.disposed,count,moved instanceof Child,Object.getPrototypeOf(moved)===DisposableStack.prototype];
    moved.dispose(); return [before,count,moved.disposed];
  `)).toMatchObject({ok:true,returnValue:[[true,false,0,false,true],1,true]});
});

it("sets disposed before callbacks and permits frozen and reentrant disposal", async () => {
  expect(await run(`
    const stack=new DisposableStack();const calls=[];
    stack.defer(()=>{calls.push(stack.disposed);stack.dispose();try{stack.defer(()=>{})}catch(e){calls.push(e.name)}});
    Object.freeze(stack);stack[Symbol.dispose]();return [calls,Reflect.ownKeys(stack)];
  `)).toMatchObject({ok:true,returnValue:[[true,'ReferenceError'],[]]});
});

it("chains every cleanup error without invoking a shadowed constructor", async () => {
  expect(await run(`
    const Native=SuppressedError; const stack=new DisposableStack();const calls=[];
    const first={id:1};const second={id:2};const third={id:3};
    stack.defer(()=>{calls.push(1);throw first});
    stack.defer(()=>{calls.push(2);throw second});
    stack.defer(()=>{calls.push(3);throw third});
    { const SuppressedError=()=>{throw 'wrong'};
    try{stack.dispose()}catch(e){return [calls,e instanceof Native,e.error===first,e.suppressed instanceof Native,e.suppressed.error===second,e.suppressed.suppressed===third,stack.disposed]} }
  `)).toMatchObject({ok:true,returnValue:[[3,2,1],true,true,true,true,true,true]});
});

it("rethrows a single cleanup failure including undefined unchanged", async () => {
  expect(await run(`const stack=new DisposableStack();stack.defer(()=>{throw undefined});try{stack.dispose();return false}catch(e){return e===undefined}`))
    .toMatchObject({ok:true,returnValue:true});
});

it("requires a new constructor and branded receivers", async () => {
  expect(await run(`
    const errors=[];try{DisposableStack()}catch(e){errors.push(e.name)};
    for(const name of ['use','adopt','defer','move','dispose']){try{DisposableStack.prototype[name].call({})}catch(e){errors.push(e.name)}}
    try{Object.getOwnPropertyDescriptor(DisposableStack.prototype,'disposed').get.call(DisposableStack.prototype)}catch(e){errors.push(e.name)}
    return errors;
  `)).toMatchObject({ok:true,returnValue:Array(7).fill('TypeError')});
});

it("validates callbacks and resources after checking disposed state", async () => {
  expect(await run(`
    const stack=new DisposableStack();const errors=[];
    for(const value of [1,'x',true,{}, {[Symbol.dispose]:null}, {[Symbol.dispose]:7}]){try{stack.use(value)}catch(e){errors.push(e.name)}}
    try{stack.defer(null)}catch(e){errors.push(e.name)};try{stack.adopt(1,null)}catch(e){errors.push(e.name)};
    const empty=[stack.use(null),stack.use(undefined)];stack.dispose();
    for(const name of ['use','adopt','defer','move']){try{stack[name](null,null)}catch(e){errors.push(e.name)}}
    return [empty,errors];
  `)).toMatchObject({ok:true,returnValue:[[null,undefined],[...Array(8).fill('TypeError'),...Array(4).fill('ReferenceError')]]});
});

it("exposes standard constructor, prototype, and method descriptors", async () => {
  expect(await run(`
    const p=DisposableStack.prototype;const d=Object.getOwnPropertyDescriptor(DisposableStack,'prototype');
    return [DisposableStack.name,DisposableStack.length,d.writable,d.enumerable,d.configurable,
      p.constructor===DisposableStack,p[Symbol.dispose]===p.dispose,Object.prototype.toString.call(new DisposableStack()),
      ['use','adopt','defer','move','dispose'].map(n=>[p[n].name,p[n].length,Object.getOwnPropertyDescriptor(p,n).enumerable])];
  `)).toMatchObject({ok:true,returnValue:['DisposableStack',0,false,false,false,true,true,'[object DisposableStack]',[['use',1,false],['adopt',2,false],['defer',1,false],['move',0,false],['dispose',0,false]]]});
});

it("does not await a promise returned by a synchronous disposer", async () => {
  expect(await run(`const stack=new DisposableStack();stack.defer(()=>new Promise(()=>{}));stack.dispose();return stack.disposed`))
    .toMatchObject({ok:true,returnValue:true});
});

it("rejects structured cloning instead of erasing resource ownership", async () => {
  expect(await run(`try{structuredClone(new DisposableStack());return false}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:'DataCloneError'});
});

it("appends to the captured resource list when a getter moves ownership", async () => {
  expect(await run(`const stack=new DisposableStack();const calls=[];let moved;
    stack.defer(()=>calls.push('old'));
    stack.use({get [Symbol.dispose](){moved=stack.move();return ()=>calls.push('new')}});
    moved.dispose();return calls;`)).toMatchObject({ok:true,returnValue:['new','old']});
});
