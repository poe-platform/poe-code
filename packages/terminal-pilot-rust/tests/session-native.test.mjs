import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TerminalPilot,TerminalSession} from '../dist/index.js';

test('public sessions drain exit output, preserve history and frozen styled screens',async()=>{
 const session=new TerminalSession({id:'real',command:process.execPath,args:['-e','process.stdout.write("\\x1b[32mready\\x1b[0m\\r\\n");process.exitCode=7'],cols:20,rows:3});
 try {
  let exits=0;session.on('exit',code=>{assert.equal(code,7);exits++;});
  assert.equal(await session.waitFor('ready'),'ready');
  assert.equal(await session.waitForExit({timeout:2000}),7);
  assert.equal(await session.close(),7); assert.equal(exits,1);
  assert.deepEqual(await session.history(),['ready']);
  assert.deepEqual(await session.history({last:0}),[]);
  const screen=await session.screen();assert.equal(screen.lines[0],'ready');assert.ok(screen.rawLines[0].includes('\x1b[32m'));assert.ok(Object.isFrozen(screen));
  await assert.rejects(session.send('late'),/already exited/);
  await session.resize(10,2);assert.deepEqual((await session.screen()).size,{cols:10,rows:2});
 }finally{await session.close();}
});
test('pilot tracks independent real interactive sessions and removes them on shutdown',async()=>{
 const pilot=await TerminalPilot.launch();
 try{
  const options={command:'/bin/sh',args:['-c','printf "ready\\n"; read value; printf "got:%s\\n" "$value"; exit 3'],cols:30,rows:4};
  const [a,b]=await Promise.all([pilot.newSession(options),pilot.newSession(options)]);
  assert.notEqual(a.id,b.id);assert.deepEqual(pilot.sessions(),[a,b]);
  await Promise.all([a.waitFor('ready'),b.waitFor('ready')]);
  await a.fill('Ada\r\n');await b.fill('Grace\n');
  assert.match(await a.waitFor(/got:Ada/g),/got:Ada/);
  assert.match(await b.waitFor('got:Grace'),/got:Grace/);
  await Promise.all([a.waitForExit({timeout:2000}),b.waitForExit({timeout:2000})]);
  assert.deepEqual(pilot.sessions(),[]);assert.equal(pilot.getSession(a.id),a);
  await pilot.close();assert.throws(()=>pilot.getSession(a.id),/Session not found/);
 }finally{await pilot.close();}
});
