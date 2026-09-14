import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

const consumers=[
  "data.decode('punycode')",
  "str(data, 'punycode')",
  "codecs.decode(data, 'punycode')",
  "codecs.getincrementaldecoder('punycode')().decode(data, True)",
];

it.each(consumers.flatMap(consumer=>[false,true].map(throws=>({consumer,throws}))))(
  "keeps prefix recovery cancellation terminal through $consumer (throws=$throws)",({consumer,throws})=>{
    const controller=new AbortController();
    let reads=0,output="";
    const session=new PythonSession({
      limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
      input:{readLine(){reads++;controller.abort();return "continue\n";}},
      output:{write(text){output+=text;},flush(){}},
    });
    const result=session.exec(`
import codecs
def handler(error):
    print('prefix')
    input()
    ${throws?"raise ValueError('after cancellation')":"return ('?', error.end)"}
codecs.register_error('strict', handler)
data = b'\\xff-a'
try:
    ${consumer}
except BaseException as error:
    print(type(error).__name__, str(error))
print('continued')
`);
    expect(result,output).toMatchObject({status:"terminated",reason:"cancelled"});
    expect(reads).toBe(1);
    expect(output).toBe("prefix\n");
    expect(session.eval("1")).toMatchObject({status:"terminated",reason:"cancelled"});
  },
);
