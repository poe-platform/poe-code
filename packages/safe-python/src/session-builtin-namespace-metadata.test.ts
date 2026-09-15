import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/builtin-namespace-metadata-3.14.7.json";

const limits={maxSteps:1_000_000,maxAllocatedBytes:8_000_000,maxDepth:100};

it.each([...reference.rows,...reference.nameErrors.map(row=>({...row,name:"NameError",behavior:row.source}))])("matches builtin metadata $name: $behavior",({source,expected})=>{
  const output:string[]=[];
  const session=new PythonSession({limits,output:{write:text=>{output.push(text);},flush(){}},hashSeed:[1n,2n]});
  const result=session.exec(source);
  let diagnostic:string|undefined;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    const rendered=session.eval("repr(failure)");
    if(rendered.status==="ok")diagnostic=String(rendered.value.primitive);
  }
  expect(result.status,diagnostic).toBe("ok");
  expect(output.join("")).toBe(expected);
});

it("isolates builtin metadata across sessions and preserves module metadata",()=>{
  const first=new PythonSession({limits,hashSeed:[1n,2n]}),second=new PythonSession({limits,hashSeed:[1n,2n]});
  expect(first.exec("__builtins__['__name__'] = 42\ndel __builtins__['__package__']\n__builtins__['__doc__'] = None").status).toBe("ok");
  expect(second.exec(`
assert __builtins__['__name__'] == 'builtins'
assert __builtins__['__package__'] == ''
assert type(__builtins__['__doc__']) is str
assert __name__ == '__main__'
assert __package__ is None
assert __doc__ is None
`).status).toBe("ok");
});
