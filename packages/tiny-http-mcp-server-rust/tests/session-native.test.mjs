import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSessionStore,defaultSessionIdGenerator} from '../dist/session.js';
import {createSessionStore as originalStore} from '../../tiny-http-mcp-server/dist/session.js';
test('native session store preserves mutable object identity replacement order and Date ownership',()=>{
 const own=createSessionStore(),old=originalStore();
 for(const store of [own,old]){
  const first=store.create('first');assert.equal(store.get('first'),first);assert.equal(store.has('first'),true);
  assert.ok(first.createdAt instanceof Date);assert.ok(first.lastSeenAt instanceof Date);
  first.initialized=true;first.authSubject='user';assert.equal(store.get('first').authSubject,'user');
  store.create('second');const replacement=store.create('first');assert.notEqual(replacement,first);
  assert.deepEqual([...store.entries()].map(s=>s.id),['first','second']);
  const date=replacement.lastSeenAt;store.touch('first');assert.notEqual(replacement.lastSeenAt,date);store.touch('missing');
  assert.equal(store.delete('first'),true);assert.equal(store.delete('first'),false);assert.equal(store.get('first'),undefined);
 }
});
test('native session iterator observes insertions deletions and replacement like Map iteration',()=>{
 for(const factory of [createSessionStore,originalStore]){
  const store=factory();store.create('a');store.create('b');const iterator=store.entries()[Symbol.iterator]();
  assert.equal(iterator.next().value.id,'a');store.delete('b');store.create('c');
  assert.equal(iterator.next().value.id,'c');assert.equal(iterator.next().done,true);
  store.create('d');assert.equal(iterator.next().done,true);
 }
});
test('native session references and order indexes remain bounded under repeated churn',()=>{
 const store=createSessionStore();for(let i=0;i<4096;i++){store.create(`session${i%8}`);if(i%2===0)store.delete(`session${i%8}`);}
 assert.equal([...store.entries()].length,4);for(const session of store.entries())store.delete(session.id);assert.equal([...store.entries()].length,0);
 const id=defaultSessionIdGenerator();assert.equal(id.length,36);assert.notEqual(id,defaultSessionIdGenerator());
});
