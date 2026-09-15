import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import {punycodeRecoveryCases} from "./punycode-recovery-cases.js";

const consumers=["data.decode('punycode', errors)","str(data, 'punycode', errors)"];

for(const consumer of consumers){
  it.each(punycodeRecoveryCases)(`${consumer}: $name`,({source})=>{
    const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
    const result=session.exec(`import _codecs\ndef decode(data, errors='strict'):\n    return ${consumer}\n${source}`);
    let detail:string|undefined;
    if(result.status==="exception"){
      session.globals.set("failure",result.exception);
      const message=session.eval("str(failure)");
      if(message.status==="ok")detail=String(message.value.primitive);
    }
    expect(result.status,detail).toBe("ok");
  });
}

it.each(consumers)("cancels Punycode prefix recovery through %s",consumer=>{
  const controller=new AbortController();let reads=0;
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
    input:{readLine(){reads++;controller.abort();return "value\n";}},output:{write(){},flush(){}}});
  const result=session.exec(`import _codecs
def handler(error):
    input()
    raise AssertionError('resumed')
_codecs.register_error('strict', handler)
data = b'\\xff-'
errors = 'strict'
${consumer}
`);
  expect(reads).toBe(1);
  expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
});
