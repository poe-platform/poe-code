import {expect,it} from 'vitest';
import {PythonSession} from './index.js';
import {codecStreamCancellationCases} from './codec-stream-service-cases.js';

it.each(codecStreamCancellationCases)('cancels $name without resuming guest calls',({source})=>{
  const controller=new AbortController();
  let reads=0;
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
    input:{readLine(){reads++;controller.abort();return 'line\n';}},output:{write(){},flush(){}}});
  expect(session.exec(source)).toMatchObject({status:'terminated',reason:'cancelled'});
  expect(reads).toBe(1);
  expect(session.eval('1')).toMatchObject({status:'terminated',reason:'cancelled'});
});
