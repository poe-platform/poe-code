import assert from 'node:assert/strict';
import * as api from 'virtual-bash';
const rows = [], shells = new Set(), unhandled = [];
process.on('unhandledRejection', reason => unhandled.push(String(reason)));
const turn = () => new Promise(resolve => setImmediate(resolve));
const capture = promise => promise.then(value => ({kind:'return',value}), reason => ({kind:'throw',reason}));
const program = 'f(){ printf "%s" "${absent:?required}"; }; guard';
function create() { const shell = new api.Shell({fs:new api.MemoryFileSystem(),cwd:'/'}).use(api.agentCommands()); shells.add(shell); return shell; }
async function record(id, action) {
  const row = {id,pass:false,role:'INDEPENDENT_EXACT_PROMISE_PROFILE_NOT_NATIVE'};
  const timer = setTimeout(() => { console.error('CASE_DEADLINE',id); process.exit(78); },30000);
  try { await action(row); row.pass=true; } catch(error) { row.error=String(error?.stack??error); }
  finally { const closed=await Promise.allSettled([...shells].map(shell=>shell.dispose()));row.created=shells.size;row.disposed=closed.filter(value=>value.status==='fulfilled').length;row.cleanupFailure=row.created!==row.disposed;shells.clear();clearTimeout(timer); }
  rows.push(row);console.log(JSON.stringify(row));if(row.cleanupFailure)process.exit(78);
}
for(const [id,reason] of [['J01-consume-zero-then-unrelated-zero',0],['J02-consume-undefined-then-unrelated-undefined',undefined]]) await record(id,async row=>{
  const shell=create();let writes=0,seen=false;
  shell.commands.register({name:'guard',execute(context){return context.invoke('f',[]).catch(error=>{assert.equal(error,reason);seen=true;return {exitCode:0};});}});
  shell.commands.register({name:'ordinary',execute(){throw reason;}});
  const outcome=await capture(shell.exec(program+'; ordinary; printf survived',{stderr:{async write(){writes++;throw reason;}}}));
  row.kind=outcome.kind;row.writes=writes;row.seen=seen;assert.equal(seen,true);assert.equal(outcome.kind,'return');assert.equal(outcome.value.exitCode,0);assert.equal(outcome.value.stdout,'survived');assert.equal(writes,2);
});
await record('J03-forwarding-thenable-is-not-exact-promise',async row=>{
  const shell=create();let writes=0;
  shell.commands.register({name:'guard',execute(context){const original=context.invoke('f',[]);const wrapper={then(resolve,reject){return original.then(resolve,reject);}};assert.notEqual(wrapper,original);return wrapper;}});
  const outcome=await capture(shell.exec(program,{stderr:{async write(){writes++;throw 0;}}}));row.kind=outcome.kind;row.writes=writes;assert.equal(outcome.kind,'return');assert.equal(outcome.value.exitCode,1);assert.equal(writes,2);row.qualification='This exact thenable is outside the exact-Promise guarantee; not arbitrary thenable parity.';
});
await record('J04-Promise-resolve-preserves-exact-identity',async row=>{
  const shell=create();let writes=0,cleaned=0;
  shell.commands.register({name:'guard',execute(context){context.registerCleanup(async()=>{await turn();cleaned++;throw 0;});const original=context.invoke('f',[]);const forwarded=Promise.resolve(original);assert.equal(forwarded,original);return forwarded;}});
  const outcome=await capture(shell.exec(program,{stderr:{async write(){writes++;throw false;}}}));row.kind=outcome.kind;row.exactFalse=outcome.reason===false;row.writes=writes;row.cleaned=cleaned;assert.equal(outcome.kind,'throw');assert.equal(outcome.reason,false);assert.equal(writes,1);assert.equal(cleaned,1);
});
await record('J05-side-catch-does-not-consume-returned-original',async row=>{
  const shell=create();let writes=0,seen=false,side;
  shell.commands.register({name:'guard',execute(context){const original=context.invoke('f',[]);side=original.catch(error=>{assert.equal(error,undefined);seen=true;return {exitCode:0};});assert.notEqual(side,original);return original;}});
  const outcome=await capture(shell.exec(program,{stderr:{async write(){writes++;throw undefined;}}}));await side;row.kind=outcome.kind;row.exactUndefined=outcome.reason===undefined;row.writes=writes;row.seen=seen;assert.equal(outcome.kind,'throw');assert.equal(outcome.reason,undefined);assert.equal(seen,true);assert.equal(writes,1);
});
await record('J06-caller-zero-during-cleanup-beats-sink-false',async row=>{
  const shell=create(),controller=new AbortController();let writes=0,cleaned=0;row.events=[];
  shell.commands.register({name:'guard',execute(context){context.registerCleanup(async()=>{row.events.push('cleanup');controller.abort(0);await turn();cleaned++;throw false;});return context.invoke('f',[]);}});
  const outcome=await capture(shell.exec(program,{signal:controller.signal,stderr:{async write(){writes++;row.events.push('diagnostic');throw false;}}}));row.kind=outcome.kind;row.exactZero=outcome.reason===0;row.writes=writes;row.cleaned=cleaned;assert.equal(outcome.kind,'throw');assert.equal(outcome.reason,0);assert.equal(cleaned,1);assert.equal(writes,1);
});
await record('J07-sibling-promises-same-reason-independent-provenance',async row=>{
  const shell=create();let writes=0,consumed=false,side;
  shell.commands.register({name:'guard',execute(context){const first=context.invoke('f',[]);side=first.catch(error=>{assert.equal(error,0);consumed=true;return {exitCode:0};});const second=context.invoke('f',[]);assert.notEqual(first,second);return second;}});
  const outcome=await capture(shell.exec(program,{stderr:{async write(){writes++;throw 0;}}}));await side;row.kind=outcome.kind;row.exactZero=outcome.reason===0;row.writes=writes;row.consumed=consumed;assert.equal(outcome.kind,'throw');assert.equal(outcome.reason,0);assert.equal(consumed,true);assert.equal(writes,2);
});
await record('J08-next-execution-does-not-inherit-diagnostic-poison',async row=>{
  const shell=create();let writes=0;shell.commands.register({name:'guard',execute(context){return context.invoke('f',[]);}});shell.commands.register({name:'ordinary',execute(){throw 0;}});
  const sink={async write(){writes++;throw 0;}};const first=await capture(shell.exec(program,{stderr:sink}));assert.equal(first.kind,'throw');assert.equal(first.reason,0);assert.equal(writes,1);
  const second=await capture(shell.exec('ordinary; printf fresh',{stderr:sink}));row.first=first.kind;row.second=second.kind;row.writes=writes;assert.equal(second.kind,'return');assert.equal(second.value.stdout,'fresh');assert.equal(second.value.exitCode,0);assert.equal(writes,2);
});
await turn();console.log(JSON.stringify({summary:{cases:rows.length,pass:rows.filter(row=>row.pass).length,fail:rows.filter(row=>!row.pass).length,native:0,unhandled}}));process.exitCode=rows.every(row=>row.pass)&&unhandled.length===0?0:1;
