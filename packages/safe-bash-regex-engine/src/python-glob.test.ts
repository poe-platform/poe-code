import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {compilePythonGlob} from './python-glob.js';
const reference=JSON.parse(readFileSync(new URL('./python-glob-reference.json',import.meta.url),'utf8')) as {names:string[];patterns:{pattern:string;matches?:string[];error?:string}[]};
test('Python filename glob syntax matches pinned Python 3.9 fnmatch cases',async()=>{
 for(const fixture of reference.patterns){
  if(fixture.error){assert.throws(()=>compilePythonGlob(fixture.pattern));continue;}
  const pattern=compilePythonGlob(fixture.pattern);
  const budget={maxBufferBytes:65536,step(){},checkpoint(){}};
  for(const name of reference.names)assert.equal(Boolean(await pattern.find(name,budget)),fixture.matches!.includes(name),JSON.stringify({pattern:fixture.pattern,name}));
 }
});
test('Python glob compilation and matching retain explicit resource and cancellation controls',async()=>{
 for(const maxPatternSource of [0,-1,0.5,NaN])assert.throws(()=>compilePythonGlob('*',{maxPatternSource}));
 assert.throws(()=>compilePythonGlob('long',{maxPatternSource:3}),/source limit/);
 assert.throws(()=>compilePythonGlob('a*b*c',{maxPatternInstructions:1}),/program limit/);
 const reason=new Error('cancel glob');
 await assert.rejects(compilePythonGlob('*').find('value',{maxBufferBytes:65536,step(){},checkpoint(){throw reason;}}),error=>error===reason);
 let steps=0;
 await assert.rejects(compilePythonGlob('*a*b*c').find('a'.repeat(1000),{maxBufferBytes:65536,step(count=1){steps+=count;if(steps>20)throw reason;},checkpoint(){}}),error=>error===reason);
 // Escaping expansion cannot turn an admitted two-character glob into a
 // rejected caller-source budget, while the kernel program cap remains active.
 const literal=compilePythonGlob('\\?',{maxPatternSource:2});
 assert.ok(await literal.find('\\x',{maxBufferBytes:65536,step(){},checkpoint(){}}));
});
