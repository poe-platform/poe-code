import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/utf7-shift-boundaries-3.14.7.json";

// Final-input rows also exercise real guest text consumers. Non-final rows
// require the incremental module API, which remains a separate open gate.
const rows=reference.rows.filter(row=>row.final);
const batches=Array.from({length:Math.ceil(rows.length/100)},(_,index)=>rows.slice(index*100,index*100+100));

it.each(batches.flatMap((rows,index)=>["literal","constructor"].map(input=>({rows,index,input}))))("matches UTF-7 oracle values and errors through public text consumers, $input batch $index",({rows,input})=>{
  const session=new PythonSession({limits:{maxSteps:4000000,maxAllocatedBytes:32000000,maxDepth:100},hashSeed:[1n,2n]});
  const cases=rows.map(row=>`(${input==="literal"?`b'${row.input.map(byte=>`\\x${byte.toString(16).padStart(2,"0")}`).join("")}'`:JSON.stringify(row.input)}, ${JSON.stringify(row.errors)}, ${row.result===undefined?"None":JSON.stringify(row.result[0])}, ${row.error===undefined?"None":JSON.stringify(row.error)}, ${row.args===undefined?"None":JSON.stringify(row.args)})`).join(",\n");
  const result=session.exec(`
for data, policy, expected, failure, args in [${cases}]:
    source = ${input==="literal"?"data":"bytes(data)"}
    for convert in (lambda: source.decode('utf-7', policy), lambda: str(source, 'utf-7', policy)):
        try:
            text = convert()
        except UnicodeDecodeError as error:
            assert failure is not None, (data, policy)
            assert type(error) is UnicodeDecodeError
            assert (error.encoding, list(error.object), error.start, error.end, error.reason) == (failure[0], failure[1], failure[2], failure[3], failure[4]), (data, policy)
            assert (error.args[0], list(error.args[1]), error.args[2], error.args[3], error.args[4]) == (args[0], args[1], args[2], args[3], args[4]), (data, policy)
        else:
            assert failure is None, (data, policy)
            assert type(text) is str
            assert [ord(char) for char in text] == expected, (data, policy)
`);
  let diagnostic:unknown=result;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    diagnostic=session.eval("repr(failure)");
  }
  expect(result.status,JSON.stringify(diagnostic,(_key,value)=>typeof value==="bigint"?String(value):value)).toBe("ok");
});
