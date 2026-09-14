import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/single-byte-tables-3.14.7.json";
import aliasReference from "./runtime/__snapshots__/single-byte-aliases-3.14.7.json";

const literal=(points:readonly number[],bytes:boolean)=>`${bytes?"b":""}'${points.map(point=>bytes?`\\x${point.toString(16).padStart(2,"0")}`:`\\U${point.toString(16).padStart(8,"0")}`).join("")}'`;

it.each([...new Set(reference.cases.map(row=>row.name))])("uses the pinned %s inventory through public text conversions",name=>{
  const session=new PythonSession({limits:{maxSteps:10000000,maxAllocatedBytes:64000000,maxDepth:100},hashSeed:[1n,2n]});
  for(const row of reference.cases.filter(row=>row.name===name)){
    const decode=row.operation==="decode",input=literal(row.input,decode);
    const expressions=[`${input}.${row.operation}(${JSON.stringify(name)}, ${JSON.stringify(row.policy)})`];
    if(decode)expressions.push(`str(${input}, ${JSON.stringify(name)}, ${JSON.stringify(row.policy)})`);
    for(const expression of expressions){
      const expected=row.expected;
      const source=expected.output!==undefined?`assert ${expression} == ${literal(expected.output,!decode)}`:expected.object===undefined?
        `try:\n    ${expression}\nexcept ${expected.error} as error:\n    assert str(error) == ${JSON.stringify(expected.message)}\nelse:\n    assert False`:
        `try:\n    ${expression}\nexcept ${expected.error} as error:\n    assert error.encoding == ${JSON.stringify(expected.encoding)}\n    assert error.object == ${literal(expected.object!,decode)}\n    assert (error.start, error.end, error.reason) == (${expected.start}, ${expected.end}, ${JSON.stringify(expected.reason)})\nelse:\n    assert False`;
      const result=session.exec(source);
      let detail="";
      if(result.status==="exception"){
        session.globals.set("failure",result.exception);
        const diagnostic=session.eval("str(failure)");
        if(diagnostic.status==="ok")detail=String(diagnostic.value.primitive);
      }
      expect(result.status,`${name} ${row.operation} ${row.policy}: ${detail}`).toBe("ok");
    }
  }
});

it.each([...new Set(aliasReference.cases.map(row=>row.name))])("resolves pinned aliases for %s",name=>{
  const session=new PythonSession({limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n]});
  for(const {spelling,error} of aliasReference.cases.filter(row=>row.name===name)){
    for(const input of ["'ABC'","b'ABC'"]){
      const method=input.startsWith("b")?"decode":"encode",call=`${input}.${method}(${JSON.stringify(spelling)}, 'replace')`;
      const source=error===undefined?`assert ${call} == ${input}.${method}(${JSON.stringify(name)}, 'replace')`:
        `try:\n    ${call}\nexcept LookupError as error:\n    assert str(error) == ${JSON.stringify(error)}\nelse:\n    assert False`;
      expect(session.exec(source).status,spelling).toBe("ok");
    }
  }
});
