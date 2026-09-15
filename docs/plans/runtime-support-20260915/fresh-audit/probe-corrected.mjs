import assert from 'node:assert/strict';
const api = await import(process.argv[2]);
const {run, Budget, lint, createRealm} = api;
console.log(JSON.stringify({date:new Date().toISOString(),entrypoint:process.argv[2],versions:process.versions,platform:process.platform,arch:process.arch}));
let failures=0;
const cases = [
 ['registered-symbol-rejection',async()=>{const r=await run('try { new WeakMap().set(Symbol.for("x"),1);return false; } catch(e) { return e instanceof TypeError; }');assert.equal(r.ok,true);assert.equal(r.returnValue,true);}],
 ['fresh-symbol-required',async()=>{const r=await run('const s=Symbol("x");const m=new WeakMap([[s,7]]);return [m.has(s),m.get(s),m.delete(s),m.has(s)];');assert.equal(r.ok,true,JSON.stringify(r.error));assert.deepEqual(r.returnValue,[true,7,true,false]);}],
 ['dynamic-authority-negative',async()=>{const r=await run('return [Function("return typeof process")(),eval("typeof fetch"),typeof require];');assert.equal(r.ok,true);assert.deepEqual(r.returnValue,['undefined','undefined','undefined']);}],
 ['prototype-isolation',async()=>{const r=await run('Object.prototype.matrixMarker=17;return ({}).matrixMarker;');assert.equal(r.returnValue,17);assert.equal(Object.prototype.matrixMarker,undefined);const next=await run('return ({}).matrixMarker;');assert.equal(next.returnValue,undefined);}],
 ['budget-fatal-unswallowable',async()=>{await assert.rejects(async()=>{await run('try { while(true){} } catch(e) {} return 1;',{budget:new Budget({maxSteps:100,maxCallDepth:20})});});}],
 ['syntax-rejection',async()=>{await assert.rejects(async()=>{await run('const = 1;');});}],
 ['lint-syntax-negative',async()=>{assert.throws(()=>lint('const = 1;'),e=>e.code==='ParseError' || e.name==='ParseError');}],
 ['error-identity',async()=>{const r=await run('try { throw new RangeError("control"); } catch(e) { return [e instanceof Error,e instanceof RangeError,e.message]; }');assert.equal(r.ok,true);assert.deepEqual(r.returnValue,[true,true,'control']);}],
 ['realm-close-revocation',async()=>{const realm=createRealm();try{assert.equal((await realm.evaluate('return 2;')).returnValue,2);}finally{await realm.close();}await realm.close();await assert.rejects(async()=>{await realm.evaluate('return 3;');});}],
 ['portable-replay-repeated',async()=>{const source='const a=[3,1,2];a.sort();return [a.join(","),new Float16Array([1.5])[0]];';let r=await run(source);assert.equal(r.ok,true);assert.deepEqual(r.returnValue,['1,2,3',1.5]);for(let i=0;i<2;i++){const snapshot=api.restore(JSON.parse(await api.dump(r)),{source});r=await run(source,{snapshot});assert.equal(r.ok,true);assert.deepEqual(r.returnValue,['1,2,3',1.5]);}}]
];
for(const [id,fn] of cases){try{await fn();console.log(JSON.stringify({id,status:'pass'}));}catch(e){failures++;console.log(JSON.stringify({id,status:'fail',error:String(e),stack:e.stack}));}}
process.exitCode=failures?1:0;
