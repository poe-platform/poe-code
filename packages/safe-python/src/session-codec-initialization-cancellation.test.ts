import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

it.each(["register(search)","unregister(search)","register_error('custom', search)","lookup('utf-8')"])("keeps lazy codec initialization cancellation terminal through %s",operation=>{
  for(const throws of [false,true]){
    const controller=new AbortController(),writes:string[]=[];
    const session=new PythonSession({
      limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
      output:{write(text){writes.push(text);controller.abort();},flush(){}}
    });
    try {
      const result=session.exec(`
import _codecs
original_import = __builtins__['__import__']
def intercept(name, *args, **kwargs):
    if name == '_codecs':
        print('initializing')
        ${throws?"raise ValueError('initializer failed')":"pass"}
    return original_import(name, *args, **kwargs)
def search(name):
    raise AssertionError('search after cancellation')
__builtins__['__import__'] = intercept
try:
    _codecs.${operation}
except BaseException:
    print('caught cancellation')
print('continued')
`);
      expect(writes).toEqual(["initializing"]);
      expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
      expect(session.exec("print('resumed')")).toMatchObject({status:"terminated",reason:"cancelled"});
      expect(writes).toEqual(["initializing"]);
    } finally {session.close();}
  }
});
