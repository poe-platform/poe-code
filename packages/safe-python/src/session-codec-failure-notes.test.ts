import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import {codecFailureNoteCases} from "./codec-failure-note-cases.js";

it.each(codecFailureNoteCases)("codec note service: $name",({source})=>{
  for(const cancel of [false,true]){
    const controller=new AbortController();let reads=0,output="";
    const session=new PythonSession({
      limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
      input:{readLine(){reads++;if(cancel)controller.abort();return "service\n";}},
      output:{write(text){output+=text;},flush(){}}
    });
    const result=session.exec(source);
    expect(reads).toBe(1);
    if(cancel){
      expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
      expect(session.eval("1")).toEqual(result);
      expect(output).toBe("");
    }else{
      expect(result.status).toBe("ok");
      expect(output).toBe("verified\n");
    }
  }
});
