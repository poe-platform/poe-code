import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/charmap-protocol-3.14.7.json";

it.each(Array.from({length:Math.ceil(reference.cases.length/24)},(_,index)=>({index,rows:reference.cases.slice(index*24,index*24+24)})))("replays pinned charmap mapping and policy contracts through _codecs, batch $index",({rows})=>{
  const session=new PythonSession({limits:{maxSteps:4000000,maxAllocatedBytes:32000000,maxDepth:100},hashSeed:[1n,2n]});
  const scripts=rows.map(row=>{
    const mapping=row.mapping;
    const lookup=mapping===null?"return None":"int" in mapping?`return ${mapping.int}`:"text" in mapping?`return ''.join(chr(point) for point in ${JSON.stringify(mapping.text)})`:
      "bytes" in mapping?`return bytes(${JSON.stringify(mapping.bytes)})`:"bool" in mapping?`return ${mapping.bool?"True":"False"}`:
      "float" in mapping?`return float(${mapping.float})`:`raise ${mapping.error}('mapping failure')`;
    const expected=row.expected,encode=row.operation==="encode";
    return `
events = []
class Mapping:
    def __getitem__(self, point):
        events.append(point)
        if point != 65 and point != 66:
            return point
        ${lookup}
source = ${encode?`''.join(chr(point) for point in ${JSON.stringify(row.input)})`:`bytes(${JSON.stringify(row.input)})`}
try:
    result, consumed = _codecs.charmap_${row.operation}(source, '${row.policy}', Mapping())
except BaseException as error:
    ${"error" in expected?`assert type(error).__name__ == '${expected.error}'
    assert str(error) == ${JSON.stringify(expected.message)}
    ${"encoding" in expected?`assert (error.encoding, ${encode?"[ord(char) for char in error.object]":"list(error.object)"}, error.start, error.end, error.reason) == (${JSON.stringify(expected.encoding)}, ${JSON.stringify(expected.object)}, ${expected.start}, ${expected.end}, ${JSON.stringify(expected.reason)})`:""}`:"raise"}
else:
    ${"output" in expected?`assert type(result) is ${encode?"bytes":"str"}
    assert type(consumed) is int
    assert ${encode?"list(result)":"[ord(char) for char in result]"} == ${JSON.stringify(expected.output)}
    assert consumed == ${expected.consumed}`:"assert False, 'expected exception'"}
assert events == ${JSON.stringify(expected.events)}
`;
  });
  const result=session.exec(`import _codecs\n${scripts.join("\n")}`);
  let detail:string|undefined;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    const message=session.eval("repr(failure)");
    if(message.status==="ok")detail=String(message.value.primitive);
  }
  expect(result.status,detail).toBe("ok");
});
