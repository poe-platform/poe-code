import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {runExplorer} from 'toolcraft-design-rust/explorer/runtime';
import {runExplorer as reference} from '../../toolcraft-design/dist/explorer/runtime.js';

test('explorer runtime composes native input, screens and terminal cleanup without driver mocks',async()=>{
  async function capture(run){
    const trace=[];const descriptors=['stdin','stdout'].map(key=>[key,Object.getOwnPropertyDescriptor(process,key)]);
    class Input extends EventEmitter{setRawMode(value){trace.push(['raw',value]);}resume(){trace.push(['resume']);}pause(){trace.push(['pause']);}}
    class Output extends EventEmitter{isTTY=true;columns=70;rows=14;write(value){trace.push(['write',value]);return true;}}
    const input=new Input(),output=new Output();
    Object.defineProperty(process,'stdin',{configurable:true,value:input});Object.defineProperty(process,'stdout',{configurable:true,value:output});
    try{
      const rows=[{id:'one',title:'One'},{id:'two',title:'Two'}];
      const result=run({title:'Native explorer',initialRows:rows,rows:async()=>rows,detail:{items:async()=>[]},actions:[]});
      input.emit('data',Buffer.from('\x1b[B\x1b[200~Tw\r\no\x1b[201~'));
      output.columns=120;output.rows=16;output.emit('resize');
      await new Promise(resolve=>setImmediate(resolve));
      input.emit('data',Buffer.from('\x03'));
      assert.equal(await result,null);
      await new Promise(resolve=>setImmediate(resolve));
      trace.push(['listeners',input.listenerCount('data'),output.listenerCount('resize')]);
      return trace;
    }finally{for(const [key,descriptor]of descriptors)Object.defineProperty(process,key,descriptor);}
  }
  assert.deepEqual(await capture(runExplorer),await capture(reference));
});
