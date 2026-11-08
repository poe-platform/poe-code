import {run, Budget} from './engine/dist/core.js';
export default Object.freeze({
  abi:'NP1-ENGINE-PUBLIC-SYNC-1', identity:'author-public-bb23-node-adapter-v1',
  async execute(input) {
    class InvocationBudget extends Budget {
      visitNode(){try{return super.visitNode();}catch(reason){input.limited(reason);throw reason;}}
      enterCall(){try{return super.enterCall();}catch(reason){input.limited(reason);throw reason;}}
      enterAwait(){try{return super.enterAwait();}catch(reason){input.limited(reason);throw reason;}}
    }
    const request=input.request;
    const context={selector:request.selector,argv:request.argv,env:request.env,cwd:request.cwd,filename:request.filename,directory:request.selector==='file'?request.filename.slice(0,request.filename.lastIndexOf('/'))||'/':request.cwd};
    const prefix='const __vnodeContext=JSON.parse('+JSON.stringify(JSON.stringify(context))+');\n';
    if(Buffer.byteLength(prefix)+Buffer.byteLength(request.program)>262144)throw new Error('combined engine source admission');
    const budget=new InvocationBudget({maxSteps:100000,maxCallDepth:128});
    try {
      const result=await run(prefix+request.program,{filename:request.filename,bindings:{__vnodeBridge:input.bridge},budget,sink:{log(){throw new Error('unexpected engine console');},error(){throw new Error('unexpected engine console');}}});
      return result.ok?{ok:true}:{ok:false,error:result.error};
    } catch(error) { return {ok:false,error}; }
  }
});
