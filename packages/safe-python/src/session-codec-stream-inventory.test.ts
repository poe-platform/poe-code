import {expect,it} from 'vitest';
import {PythonSession} from './index.js';
import {codecStreamInventoryCases} from './codec-stream-inventory-cases.js';
import reference from './runtime/__snapshots__/codec-stream-inventory-3.14.7.json';

it.each(codecStreamInventoryCases)('$name own members and function descriptors',({name,source})=>{
  let output='';
  const session=new PythonSession({limits:{maxSteps:4000000,maxAllocatedBytes:64000000,maxDepth:150},hashSeed:[1n,2n],output:{write(text){output+=text;},flush(){}}});
  const result=session.exec(source);
  expect(result).toMatchObject({status:'ok'});
  expect(output).toBe(reference.cases.find(row=>row.name===name)!.output);
});
