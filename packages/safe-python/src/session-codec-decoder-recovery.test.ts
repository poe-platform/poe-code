import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

const inputs=[
  ["utf-8-sig",String.raw`b'\xef\xbb\xbf\xff'`],
  ["utf-16-le",String.raw`b'\x00\xd8'`],
  ["utf-32-le",String.raw`b'\x00\xd8\x00\x00'`],
  ["utf-7",String.raw`b'+!'`],
  ["unicode-escape",String.raw`b'\uQQQQ'`],
  ["raw-unicode-escape",String.raw`b'\uQQQQ'`],
  ["cp1252",String.raw`b'\x81'`],
];
const policies=["strict","ignore","replace","surrogateescape","surrogatepass","backslashreplace","xmlcharrefreplace","namereplace","custom"];

function run(source:string,warningCount=0){
  const warnings: {category:string;message:string}[]=[];
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],warning:warning=>warnings.push(warning)});
  const result=session.exec(source);
  let detail:string|undefined;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    const message=session.eval("str(failure)");
    if(message.status==="ok")detail=String(message.value.primitive);
  }
  expect(result.status,detail).toBe("ok");
  expect(warnings).toHaveLength(warningCount);
  for(const warning of warnings)expect(warning).toMatchObject({category:"SyntaxWarning",message:expect.stringContaining("invalid escape sequence")});
}

// CPython 3.14.7 / Unicode 16.0.0: only UTF-8's three native decode
// policies bypass replacement registrations for these encoding families.
it.each(inputs.flatMap(([encoding,input])=>policies.flatMap(policy=>[false,true].map(constructor=>({encoding,input,policy,constructor})))))(
  "uses the registry for $encoding/$policy (str constructor=$constructor)",({encoding,input,policy,constructor})=>{
    const bypass=encoding==="utf-8-sig"&&["ignore","replace","surrogateescape"].includes(policy);
    const expected=bypass?policy==="ignore"?"''":policy==="replace"?"'�'":String.raw`'\udcff'`:"'!'";
    const expression=constructor?`str(${input}, '${encoding}', '${policy}')`:`${input}.decode('${encoding}', '${policy}')`;
    run(`
import _codecs
seen = []
def handler(error):
    seen.append(error)
    return ('!', len(error.object))
_codecs.register_error('${policy}', handler)
assert ${expression} == ${expected}
assert len(seen) == ${bypass?0:1}
`,encoding.includes("unicode-escape")?1:0);
  });

it.each(inputs)("preserves guest failure identity for %s",(encoding,input)=>{
  run(`
import _codecs
failure = ValueError('handler failed')
def handler(error):
    raise failure
_codecs.register_error('custom', handler)
try:
    ${input}.decode('${encoding}', 'custom')
except ValueError as caught:
    assert caught is failure
else:
    assert False
`,encoding.includes("unicode-escape")?1:0);
});

it.each(inputs)("resumes from a negative position in replaced %s input",(encoding,input)=>{
  const replacement=encoding==="utf-16-le"?String.raw`b'X\x00Y\x00'`:encoding==="utf-32-le"?String.raw`b'X\x00\x00\x00Y\x00\x00\x00'`:"b'XY'";
  const position=encoding==="utf-16-le"?-2:encoding==="utf-32-le"?-4:-1;
  run(`
import _codecs
seen = []
class Position:
    def __index__(self):
        seen[0].object = ${replacement}
        return ${position}
def handler(error):
    seen.append(error)
    return ('?', Position())
_codecs.register_error('custom', handler)
assert ${input}.decode('${encoding}', 'custom') == '?Y'
assert len(seen) == 1
assert seen[0].object == ${replacement}
`,encoding.includes("unicode-escape")?1:0);
});

it.each(inputs.flatMap(([encoding,input])=>[false,true].map(raises=>({encoding,input,raises}))))(
  "cancels $encoding recovery before the guest resumes (raises=$raises)",({encoding,input,raises})=>{
    const controller=new AbortController();let reads=0;
    const warnings:string[]=[];
    const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
      warning:warning=>warnings.push(warning.category),
      input:{readLine(){reads++;controller.abort();return 'value\n';}},output:{write(){},flush(){}}});
    const result=session.exec(`
import _codecs
def handler(error):
    input()
    ${raises?"raise ValueError('resumed')":"return ('?', error.end)"}
_codecs.register_error('custom', handler)
${input}.decode('${encoding}', 'custom')
`);
    expect(reads).toBe(1);
    expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
    expect(warnings).toEqual(encoding.includes("unicode-escape")?["SyntaxWarning"]:[]);
  });

it.each(inputs.flatMap(([encoding,input])=>[
  ["(b'?', 1)","TypeError","decoding error handler must return (str, int) tuple"],
  ["('?', 1.0)","TypeError","'float' object cannot be interpreted as an integer"],
  ["('?', 9223372036854775808)","OverflowError","Python int too large to convert to C ssize_t"],
  ["('?', len(error.object) + 1)","IndexError",undefined],
].map(([result,type,message])=>({encoding,input,result,type,message}))))(
  "validates $encoding handler result $result",({encoding,input,result,type,message})=>{
    run(`
import _codecs
def handler(error):
    return ${result}
_codecs.register_error('custom', handler)
try:
    ${input}.decode('${encoding}', 'custom')
except ${type} as error:
    ${message===undefined?"assert 'out of bounds' in str(error)":`assert str(error) == ${JSON.stringify(message)}`}
else:
    assert False
`,encoding.includes("unicode-escape")?1:0);
  });

it("caches a decoder handler per conversion and re-resolves on the next conversion",()=>{
  run(`
import _codecs
seen = []
def next_handler(error):
    seen.append('next')
    return ('!', error.end)
def handler(error):
    seen.append(error)
    _codecs.register_error('cached', next_handler)
    return ('?', error.end)
_codecs.register_error('cached', handler)
assert b'\\x81X\\x81'.decode('cp1252', 'cached') == '?X?'
assert seen[0] is seen[1]
assert seen[0].args[2:4] == (0, 1)
assert (seen[0].start, seen[0].end) == (2, 3)
assert b'\\x81'.decode('cp1252', 'cached') == '!'
assert seen[2] == 'next'
`);
});
