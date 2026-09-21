import test from 'node:test';import assert from 'node:assert/strict';
import {registerExecutionEnvFactory,selectExecutionEnv,selectExecutionEnvFactory} from '../dist/index.js';import {native} from '../dist/native.js';
test('registered execution factories preserve identity, replacement and getter order',()=>{
 const events=[],first={get type(){events.push('type');return 'host';},async open(){return {id:'first'};},async attach(){return {id:'first'};}},second={...first,async open(){return {id:'second'};}};
 events.length=0;registerExecutionEnvFactory(first);assert.deepEqual(events,['type']);assert.equal(selectExecutionEnvFactory('host'),first);
 registerExecutionEnvFactory(second);assert.equal(selectExecutionEnv({type:'host'}),second);
 assert.throws(()=>selectExecutionEnvFactory('unregistered'),{message:'No execution environment factory registered for runtime type "unregistered".'});
});
test('native factory replacement reuses slots and registries are independent',()=>{
 const one=new native.NativeHarnessFactories(),two=new native.NativeHarnessFactories();
 assert.equal(one.get('host'),null);assert.equal(one.register('host'),0);assert.equal(one.register('docker'),1);
 for(let i=0;i<8192;i++)assert.equal(one.register('host'),0);
 assert.equal(two.get('host'),null);assert.equal(one.register('\ud800'),2);assert.equal(one.get('\ud800'),2);assert.equal(one.get('Host'),null);
});
