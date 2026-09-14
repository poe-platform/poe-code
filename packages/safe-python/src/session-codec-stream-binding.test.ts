import {expect,it} from 'vitest';
import {PythonSession} from './index.js';
import {codecStreamBindingCases} from './codec-stream-binding-cases.js';
import reference from './runtime/__snapshots__/codec-stream-binding-3.14.7.json';

it.each(codecStreamBindingCases)('$name method binding matches the pinned interpreter',({name,source})=>{
  let output='';
  const session=new PythonSession({limits:{maxSteps:4000000,maxAllocatedBytes:64000000,maxDepth:150},hashSeed:[1n,2n],output:{write(text){output+=text;},flush(){}}});
  expect(session.exec(source)).toMatchObject({status:'ok'});
  expect(output).toBe(reference.cases.find(row=>row.name===name)!.output);
});
