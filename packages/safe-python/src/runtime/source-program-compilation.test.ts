import {expect,it,vi} from "vitest";
import {compileSourceProgram,PythonSyntaxError} from "../index.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

const constants={string:(value:string):unknown=>value,integer:(value:number):unknown=>value,tuple:(values:readonly unknown[]):unknown=>values};
const options={stripDocstring:false,enterRecursiveCall:()=>()=>{}};
const budget=()=>new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:2000000});

it.each([1,2] as const)("eliminates assertions at optimization level %s without changing generator classification",optimize=>{
  const program=compileSourceProgram('"doc"\nassert missing\nif True:\n assert missing\ndef f():\n "function doc"\n assert (yield 1)\n return __debug__\nclass C:\n "class doc"\n assert missing\n',{...options,optimize},constants,budget());
  expect(program.module.statements.map(statement=>statement.kind)).toEqual(["if","function","class"]);
  const conditional=program.module.statements[0];if(conditional.kind!=="if")throw Error("expected if");
  expect(conditional.branches[0].body).toEqual([]);
  const fn=[...program.functions.values()][0];expect(fn.kind).toBe("generator");
  expect(fn.body).toMatchObject({kind:"suite",statements:[{kind:"return"}]});
  expect([...program.classes.values()][0].statements).toEqual([]);
  expect(program.module.docstring).toEqual(optimize===2?undefined:{value:"doc"});
  expect(fn.docstring).toEqual(optimize===2?undefined:{value:"function doc"});
  expect([...program.classes.values()][0].docstring).toEqual(optimize===2?undefined:{value:"class doc"});
});
it.each([-1,3,0.5,NaN])("rejects unresolved/invalid host optimization levels: %s",optimize=>{
  expect(()=>compileSourceProgram('pass',{...options,optimize:optimize as 0},constants,budget())).toThrow(RangeError);
});
it("snapshots optimization before compilation callbacks",()=>{
  const settings={...options,optimize:1 as 0|1|2};
  const program=compileSourceProgram('assert x\ndef f():assert x',settings,{...constants,string(value){settings.optimize=0;return value;}},budget());
  expect(program.module.statements.map(statement=>statement.kind)).toEqual(["function"]);
  expect([...program.functions.values()][0].body).toMatchObject({kind:"suite",statements:[]});
});

it.each([
  [[0x22,0xc3,0xa9,0x22],"é"],
  [[0xef,0xbb,0xbf,0x22,0xf0,0x9f,0x90,0x8d,0x22],"🐍"],
  [[...new TextEncoder().encode('# coding: latin-1\n"'),0xe9,0x22],"é"],
  [[...new TextEncoder().encode('# coding: ascii\n"ascii"')],"ascii"]
] as const)("compiles byte sources with their declared encoding: %j",(bytes,doc)=>{
  expect(compileSourceProgram(new Uint8Array(bytes),options,constants,budget()).module.docstring).toEqual({value:doc});
});
it.each([[0xff],[...new TextEncoder().encode('# coding: unknown\npass')],[...new TextEncoder().encode('# coding: ascii\n"'),0xff,34]].map(bytes=>({bytes})))("reports byte decoding failures as syntax errors: %j",({bytes})=>{
  expect(()=>compileSourceProgram(new Uint8Array(bytes),{...options,filename:"bytes.py"},constants,budget())).toThrow(PythonSyntaxError);
});
it("uses an explicit additional source codec and keeps text declarations inert",()=>{
  const decodeSource=vi.fn((encoding:string)=>encoding==="custom"?'"decoded"':'"other"');
  expect(compileSourceProgram(new TextEncoder().encode('# coding: custom\nignored'),{...options,decodeSource},constants,budget()).module.docstring).toEqual({value:"decoded"});
  expect(decodeSource.mock.calls[0][0]).toBe("custom");
  expect(compileSourceProgram('# coding: unknown\n"text"',{...options,decodeSource},constants,budget()).module.docstring).toEqual({value:"text"});
  expect(decodeSource).toHaveBeenCalledTimes(1);
});
it("rejects byte NULs before encoding lookup or compilation callbacks",()=>{
  const decodeSource=vi.fn();
  expect(()=>compileSourceProgram(new TextEncoder().encode('# coding: custom\n\0'),{...options,decodeSource},constants,budget())).toThrow("null bytes");
  expect(decodeSource).not.toHaveBeenCalled();
});
it("preserves cancellation from a failing source codec",()=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  expect(()=>compileSourceProgram(new TextEncoder().encode('# coding: custom\npass'),{...options,decodeSource(){controller.abort();throw Error("codec failure");}},constants,meter)).toThrow(ExecutionLimitError);
});
it("consumes at most one byte-source BOM",()=>{
  expect(()=>compileSourceProgram(new TextEncoder().encode('\ufeff\ufeffpass'),options,constants,budget())).toThrow(PythonSyntaxError);
});
it("rejects an initial BOM in text while accepting it in byte source",()=>{
  expect(()=>compileSourceProgram('\ufeffpass',options,constants,budget())).toThrow("invalid non-printable character U+FEFF");
  expect(()=>compileSourceProgram(new TextEncoder().encode('\ufeffpass'),options,constants,budget())).not.toThrow();
  try{compileSourceProgram('\ufeffpass\n',{...options,filename:"bom.py"},constants,budget());expect.unreachable();}
  catch(error){expect(error).toMatchObject({sourceLine:'\ufeffpass',position:{column:0,line:1},endPosition:{column:0,line:1},filename:"bom.py"});}
});

it.each(['""','"  value\\n  "','"\\ud800"'])("keeps eval strings as expressions, not docstrings: %s",source=>{
  const string=vi.fn(constants.string);
  const program=compileSourceProgram(source,{...options,mode:"eval",stripDocstring:true},{...constants,string},budget());
  expect(program.module.expression).toMatchObject({kind:"literal",literalKind:"string"});
  expect(program.module.docstring).toBeUndefined();expect(program.module.statements).toEqual([]);
  expect(string.mock.calls).toEqual([["<string>"]]);
});
it("prepares nested eval code with one shared source and scope graph",()=>{
  const program=compileSourceProgram("(lambda x:lambda:x, (x for x in xs))",{...options,mode:"eval",filename:"eval.py"},constants,budget());
  expect(program.module.expression?.kind).toBe("tuple");
  expect([...program.functions.values()].map(code=>code.qualifiedName)).toEqual(["<lambda>","<lambda>.<locals>.<lambda>"]);
  expect(program.generatorExpressions?.size).toBe(1);
  for(const code of program.functions.values())expect(code.source).toBe(program.module.source);
});
it.each(["x=1","await x","(yield 1)"])("uses eval grammar and context validation: %s",source=>{
  expect(()=>compileSourceProgram(source,{...options,mode:"eval"},constants,budget())).toThrow(PythonSyntaxError);
});

it("compiles source into identity-linked nested code without executing it",()=>{
  const program=compileSourceProgram('"doc"\ndef outer(x):\n class C:\n  def method(self): return x\n return C\nmissing()', {...options,filename:"../🐍.py"},constants,budget());
  expect(program.module.docstring).toEqual({value:"doc"});
  expect([...program.functions.values()].map(code=>code.qualifiedName)).toEqual(["outer","outer.<locals>.C.method"]);
  for(const code of program.functions.values())expect(code.source).toBe(program.module.source);
  expect(program.module.source?.filename).toBe("../🐍.py");
});
it.each(["x=", "return 1", "def f(): nonlocal missing"])("preserves source diagnostics: %s",source=>{
  expect(()=>compileSourceProgram(source,{...options,filename:"input.py"},constants,budget())).toThrow(PythonSyntaxError);
  try{compileSourceProgram(source,{...options,filename:"input.py"},constants,budget());}catch(error){expect(error).toMatchObject({filename:"input.py",sourceLine:expect.any(String)});}
});
it("charges source analysis before allocating guest constants",()=>{
  const string=vi.fn(constants.string);
  expect(()=>compileSourceProgram("x="+"1+".repeat(100)+"1",options,{...constants,string},new ExecutionBudget({maxSteps:50,maxAllocatedBytes:1000000}))).toThrow(ExecutionLimitError);
  expect(string).not.toHaveBeenCalled();
});
it("uses the same cumulative meter for analysis and code preparation",()=>{
  const meter=budget(),charges:number[]=[];
  compileSourceProgram("pass",options,{...constants,string(value){charges.push(meter.usage.allocatedBytes);return value;}},meter);
  expect(charges[0]).toBeGreaterThan(448);
  expect(meter.usage.allocatedBytes).toBeGreaterThan(charges[0]);
});
it("forwards lexical callbacks once",()=>{
  const onComment=vi.fn(),onWarning=vi.fn();
  compileSourceProgram("match='\\q' # comment",{...options,onComment,onWarning},constants,budget());
  expect(onComment).toHaveBeenCalledTimes(1);expect(onWarning).toHaveBeenCalledTimes(1);
});
it("restores the shared recursion guard after a rejected entry",()=>{
  let depth=0;const failure=new Error("recursion policy");
  const enterRecursiveCall=()=>{if(depth===3)throw failure;depth++;return ()=>{depth--;};};
  expect(()=>compileSourceProgram("x="+"-".repeat(20)+"1",{...options,enterRecursiveCall},constants,budget())).toThrow(failure);
  expect(depth).toBe(0);
});
it("preserves cancellation from a throwing constant adapter",()=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  expect(()=>compileSourceProgram("pass",options,{...constants,string(){controller.abort();throw new Error("constant failure");}},meter)).toThrow(ExecutionLimitError);
});
it("binds aliases without evaluating type expressions and strips nested docstrings",()=>{
  const program=compileSourceProgram('"doc"\ntype Alias[T: missing()] = absent()\ndef f[T](x: nonexistent()) -> missing():\n "function doc"\n return x',{...options,stripDocstring:true},constants,budget());
  expect(program.module.docstring).toBeUndefined();
  expect([...program.functions.values()][0].docstring).toBeUndefined();
  expect([...program.module.scope.bindings.keys()]).toEqual(["Alias","f"]);
});
