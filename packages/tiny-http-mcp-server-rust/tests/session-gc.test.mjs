import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('session-store cycles remain visible to JavaScript GC after the store becomes unreachable',()=>{
 const moduleUrl=new URL('../dist/session.js',import.meta.url).href;
 const child=spawnSync(process.execPath,['--expose-gc','--input-type=module','-e',`
  import assert from 'node:assert/strict';
  import {setImmediate} from 'node:timers/promises';
  import {createSessionStore} from ${JSON.stringify(moduleUrl)};
  const weak=(()=>{const store=createSessionStore();store.create('a').owner=store;return new WeakRef(store);})();
  for(let i=0;i<20;i++){await setImmediate();global.gc();}
  assert.equal(weak.deref(),undefined,'native ownership must not keep an unreachable store cycle alive');
 `],{encoding:'utf8',timeout:3000});
 assert.equal(child.status,0,child.stderr||child.error?.message);
});
