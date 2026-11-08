import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import * as own from '../dist/index.js';
import * as reference from '../../user-error/dist/index.js';
const native=createRequire(import.meta.url)('../dist/user-error-rust.node');

test('real native error taxonomy and Node errors match original messages hints and causes',()=>{
 assert.equal(native.USER_ERROR_NAME,'UserError');
 for(const message of ['','bad input','Unicode 🦀\0\ud800'])for(const options of [undefined,{}, {hint:''},{hint:'Create a key'},{cause:undefined},{cause:{nested:{value:12n}},hint:'repair'}]){
  const a=new own.UserError(message,options),b=new reference.UserError(message,options);
  assert.ok(a instanceof Error);assert.equal(a.name,b.name);assert.equal(a.message,b.message);assert.equal(a.hint,b.hint);assert.equal(a.cause,b.cause);
  for(const key of ['message','name','hint','cause'])assert.deepEqual(Object.getOwnPropertyDescriptor(a,key),Object.getOwnPropertyDescriptor(b,key));
  assert.equal(own.isUserError(a),reference.isUserError(a));assert.equal(reference.isUserError(a),true);
 }
});

test('guards preserve foreign bundle recognition, realm behavior and short circuit name access',()=>{
 const foreign=new Error('foreign');foreign.name='UserError';
 const fake={get name(){throw new Error('plain objects must not be inspected');}};
 for(const value of [foreign,new reference.UserError('reference'),new Error('plain'),new TypeError('plain'),undefined,null,12,'UserError',{name:'UserError'},fake,vm.runInNewContext('Object.assign(new Error("foreign realm"),{name:"UserError"})')])assert.equal(own.isUserError(value),reference.isUserError(value));
 const nameGetter=new Error();Object.defineProperty(nameGetter,'name',{get(){throw new Error('name failure');}});
 assert.throws(()=>own.isUserError(nameGetter),/name failure/);assert.throws(()=>reference.isUserError(nameGetter),/name failure/);
 const sub=new class extends own.UserError{}('subclass');assert.equal(own.isUserError(sub),true);assert.ok(sub.stack.startsWith('UserError: subclass'));
});

test('standard ErrorOptions and hint getters are evaluated in the original order',()=>{
 for(const factory of [own.UserError,reference.UserError]){
  const reads=[],cause={cycle:null};cause.cycle=cause;
  const options={get cause(){reads.push('cause');return cause;},get hint(){reads.push('hint');return 'repair';}};
  const error=new factory('bad input',options);assert.deepEqual(reads,['cause','hint']);assert.equal(error.cause,cause);assert.equal(error.hint,'repair');
  const inherited=Object.create({cause,hint:'inherited'}),other=new factory('inherited',inherited);assert.equal(other.cause,cause);assert.equal(other.hint,'inherited');
 }
});

test('arbitrary cause cycles remain collectable through the actual native artifact',()=>{
 const moduleUrl=new URL('../dist/index.js',import.meta.url).href;
 const child=spawnSync(process.execPath,['--expose-gc','--input-type=module','-e',`
  import assert from 'node:assert/strict';
  import {UserError} from ${JSON.stringify(moduleUrl)};
  const weak=(()=>{const cause={},error=new UserError('cyclic',{cause});cause.error=error;return [new WeakRef(cause),new WeakRef(error)];})();
  for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));global.gc();}
  assert.ok(weak.every(value=>value.deref()===undefined));
 `],{encoding:'utf8',timeout:2000});assert.equal(child.status,0,child.stderr||child.error?.message);
});
