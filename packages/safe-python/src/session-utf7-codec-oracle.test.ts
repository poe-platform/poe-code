import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/utf7-3.14.7.json";
import shifts from "./runtime/__snapshots__/utf7-shift-boundaries-3.14.7.json";

const rows=[...reference.decode.map(row=>({...row,args:row.error})),...shifts.rows.map(row=>({...row,failure:undefined}))];
const batches=Array.from({length:Math.ceil(rows.length/100)},(_,index)=>({index,rows:rows.slice(index*100,index*100+100)}));

it.each(batches)("replays all pinned native UTF-7 decoder contracts, batch $index",({rows})=>{
  const session=new PythonSession({limits:{maxSteps:4000000,maxAllocatedBytes:32000000,maxDepth:100},hashSeed:[1n,2n]});
  const cases=rows.map(row=>`(${JSON.stringify(row.input)}, ${JSON.stringify(row.errors)}, ${row.final?"True":"False"}, ${row.result===undefined?"None":JSON.stringify(row.result)}, ${row.error===undefined?"None":JSON.stringify(row.error)}, ${row.args===undefined?"None":JSON.stringify(row.args)}, ${row.failure===undefined?"None":JSON.stringify(row.failure)})`).join(",\n");
  const result=session.exec(`
import _codecs
for data, policy, final, expected, fields, args, failure in [${cases}]:
    try:
        text, consumed = _codecs.utf_7_decode(bytes(data), policy, final)
    except UnicodeDecodeError as error:
        assert fields is not None, (data, policy, final)
        assert type(error) is UnicodeDecodeError
        assert (error.encoding, list(error.object), error.start, error.end, error.reason) == (fields[0], fields[1], fields[2], fields[3], fields[4]), (data, policy, final)
        assert (error.args[0], list(error.args[1]), error.args[2], error.args[3], error.args[4]) == (args[0], args[1], args[2], args[3], args[4]), (data, policy, final)
    except (TypeError, LookupError) as error:
        assert failure is not None, (data, policy, final)
        assert type(error).__name__ == failure[0]
        assert error.args == (failure[1],)
    else:
        assert expected is not None, (data, policy, final)
        assert type(text) is str
        assert type(consumed) is int
        assert [ord(char) for char in text] == expected[0], (data, policy, final)
        assert consumed == expected[1], (data, policy, final)
`);
  let detail:string|undefined;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    const message=session.eval("repr(failure)");
    if(message.status==="ok")detail=String(message.value.primitive);
  }
  expect(result.status,detail).toBe("ok");
});

it.each(Array.from({length:Math.ceil(reference.encode.length/100)},(_,index)=>({index,rows:reference.encode.slice(index*100,index*100+100)})))("replays all pinned native UTF-7 encoder contracts, batch $index",({rows})=>{
  const session=new PythonSession({limits:{maxSteps:4000000,maxAllocatedBytes:32000000,maxDepth:100},hashSeed:[1n,2n]});
  const cases=rows.map(row=>`(${JSON.stringify(row.input)}, ${JSON.stringify(row.result)})`).join(",\n");
  expect(session.exec(`
import _codecs
for points, expected in [${cases}]:
    source = ''.join(chr(point) for point in points)
    encoded, consumed = _codecs.utf_7_encode(source)
    assert type(encoded) is bytes
    assert type(consumed) is int
    assert list(encoded) == expected, points
    assert consumed == len(source), points
`)).toEqual({status:"ok"});
});
