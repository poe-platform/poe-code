import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

it.each(["ascii_encode","latin_1_encode","utf_8_encode","ascii_decode","utf_8_decode"])("keeps public _codecs.%s recovery cancellation fatal",operation=>{
  for(const stage of ["handler","index"]){
    for(const throws of [false,true]){
      const controller=new AbortController(),writes:string[]=[];
      const session=new PythonSession({limits:{maxSteps:300000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
        output:{write(text){writes.push(text);controller.abort();},flush(){}}
      });
      const cancel=`print('cancel')${throws?"; raise ValueError('after cancellation')":""}`;
      const result=session.exec(`
from _codecs import ${operation} as convert, register_error
class Position:
    def __index__(self):
        ${stage==="index"?cancel:"pass"}
        return -1
def handler(error):
    ${stage==="handler"?cancel:"pass"}
    return ('!', Position())
register_error('public_core_cancellation', handler)
try:
    convert(${operation.endsWith("encode")?"'\\ud800Z'":"b'\\xffZ'"}, 'public_core_cancellation')
except BaseException:
    print('recovered')
`);
      expect(writes,`${stage}, throws=${throws}`).toEqual(["cancel"]);
      expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
      expect(session.eval("1")).toMatchObject({status:"terminated",reason:"cancelled"});
    }
  }
});
