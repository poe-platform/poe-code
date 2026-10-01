import {test, expect} from 'vitest';
import binaryen from 'binaryen';
import {meterPythonWasm} from '../scripts/meter-python.mjs';

test('meters back edges and caps memory without losing initialized bytes', async () => {
  const m=new binaryen.Module();
  m.setMemory(1,65536,'memory',[{offset:m.i32.const(8),data:new Uint8Array([42]),passive:false}]);
  m.addFunction('spin',binaryen.none,binaryen.none,[],m.loop('repeat',m.br('repeat')));
  m.addFunctionExport('spin','spin');
  const metered=meterPythonWasm(m.emitBinary());m.dispose();
  let work=0;
  const {instance}=await WebAssembly.instantiate(metered,{csvpy:{work(){if(++work>100)throw new Error('exhausted');}}});
  expect(new Uint8Array((instance.exports.memory as WebAssembly.Memory).buffer)[8]).toBe(42);
  expect(()=>(instance.exports.spin as () => void)()).toThrow('exhausted');
  expect(work).toBe(101);
  expect(()=>(instance.exports.memory as WebAssembly.Memory).grow(4096)).toThrow(RangeError);
});

test('meters recursion even without loop instructions', async () => {
  const m=new binaryen.Module();
  m.addFunction('again',binaryen.none,binaryen.none,[],m.call('again',[],binaryen.none));
  m.addFunctionExport('again','again');
  const bytes=meterPythonWasm(m.emitBinary());m.dispose();
  let work=0;
  const {instance}=await WebAssembly.instantiate(bytes,{csvpy:{work(){if(++work>20)throw new Error('exhausted');}}});
  expect(()=>(instance.exports.again as () => void)()).toThrow('exhausted');
  expect(work).toBe(21);
});
