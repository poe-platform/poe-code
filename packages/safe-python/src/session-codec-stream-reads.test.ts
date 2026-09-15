import {expect,it} from 'vitest';
import {PythonSession} from './index.js';
import {codecStreamReadCases} from './codec-stream-read-cases.js';
import reference from './runtime/__snapshots__/codec-stream-reads-3.14.7.json';

it.each(codecStreamReadCases)('$name retains exact read results, failures and buffers',({name,source})=>{
  let output='';
  const session=new PythonSession({limits:{maxSteps:4000000,maxAllocatedBytes:64000000,maxDepth:150},hashSeed:[1n,2n],output:{write(text){output+=text;},flush(){}}});
  expect(session.exec(source)).toMatchObject({status:'ok'});
  expect(output).toBe(reference.cases.find(row=>row.name===name)!.output);
});
