import {expect,it} from 'vitest';
import {PythonSession} from './index.js';

// Required public propagation gate. CPython 3.14.7 reports both real frames;
// a sentinel traceback or dropping instruction offsets would not satisfy it.
it('retains caller and codec frames with pinned instruction positions',()=>{
  let output='';
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],output:{write(text){output+=text;},flush(){}}});
  const source=`import codecs
try:
    codecs.IncrementalEncoder().encode('')
except NotImplementedError as error:
    tb = error.__traceback__
    while tb is not None:
        print(tb.tb_frame.f_code.co_name, tb.tb_lineno, tb.tb_lasti)
        tb = tb.tb_next
`;
  expect(session.exec(source,{filename:'<codec-trace>'})).toMatchObject({status:'ok'});
  expect(output).toBe('<module> 3 66\nencode 204 12\n');
});
