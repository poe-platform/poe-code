import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import {codecNativeFailureCases} from "./codec-native-failure-cases.js";

it.each(codecNativeFailureCases)("native codec failure: $name",({source})=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(source);
  let detail:string|undefined;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    const diagnostic=session.eval("str(failure)");
    if(diagnostic.status==="ok")detail=String(diagnostic.value.primitive);
  }
  expect(result.status,detail).toBe("ok");
});

it.each(["encode","decode"])("does not annotate or catch cancellation during native %s recovery",operation=>{
  const controller=new AbortController();
  let reads=0;
  const session=new PythonSession({
    limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
    input:{readLine(){reads++;controller.abort();return "cancelled\n";}},output:{write(){},flush(){}}
  });
  const result=session.exec(`
import _codecs
def handler(error):
    input()
    raise ValueError('guest failure')
_codecs.register_error('cancel_native', handler)
try:
    ${operation==="encode"?"'\\ud800'.encode('utf-8-sig', 'cancel_native')":"b'\\xff'.decode('utf-8-sig', 'cancel_native')"}
except BaseException:
    raise AssertionError('cancellation reached guest')
`);
  expect(reads).toBe(1);
  expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
  expect(session.exec("assert False")).toMatchObject({status:"terminated",reason:"cancelled"});
});
