import {expect,it} from 'vitest';
import {PythonSession} from './index.js';
import {codecStreamStateCases} from './codec-stream-state-cases.js';
import {codecStreamIteratorCases} from './codec-stream-iterator-cases.js';
import {codecStreamFailureCases} from './codec-stream-failure-cases.js';

it.each([...codecStreamStateCases,...codecStreamIteratorCases,...codecStreamFailureCases])('$name',({source})=>{
  const session=new PythonSession({limits:{maxSteps:4000000,maxAllocatedBytes:64000000,maxDepth:150},hashSeed:[1n,2n]});
  const result=session.exec(source);
  let detail:unknown=result;
  if(result.status==='exception'){
    session.globals.set('failure',result.exception);
    detail=session.eval('str(failure)');
  }
  expect(result.status,JSON.stringify(detail)).toBe('ok');
});
