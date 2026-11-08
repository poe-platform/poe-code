import assert from "node:assert/strict";
import {test} from "node:test";
import {PassThrough,Writable} from "node:stream";
import {Prompt as Original,nonTtyPromptMessage as originalMessage} from "../../toolcraft-design/dist/prompts/interactive/core.js";

function harness(tty=true,columns=40){
  const frames=[],rawModes=[],input=new PassThrough();
  input.isTTY=tty;input.setRawMode=value=>rawModes.push(value);
  const output=new Writable({write(chunk,encoding,done){frames.push(chunk.toString());done();}});output.columns=columns;
  return {input,output,frames,rawModes};
}
async function scenario(Base,{track=true,initial="",keys=[],validate,abort=false,columns=40}={}){
  const h=harness(true,columns),controller=new AbortController(),trace=[];
  const prompt=new Base({input:h.input,output:h.output,signal:controller.signal,initialValue:initial,initialUserInput:initial,validate,render:p=>`${p.state}: ${p.userInput}\n${p.error}`},track);
  if(track)prompt.on("userInput",value=>prompt.setValue(value));
  for(const name of ["value","userInput","cursor","confirm","key","finalize","submit","cancel"])prompt.on(name,(...args)=>trace.push([name,...args]));
  const result=prompt.prompt();
  for(const [char,key]of keys)h.input.emit("keypress",char,key);
  if(abort)controller.abort();else h.input.emit("keypress","\r",{name:"return"});
  const value=await result;
  const state={state:prompt.state,value:prompt.value,userInput:prompt.userInput,error:prompt.error,cursor:prompt.cursor,keys:Object.keys(prompt),listeners:prompt.eventNames(),inputListeners:h.input.listenerCount("keypress"),resizeListeners:h.output.listenerCount("resize")};
  h.input.destroy();h.output.destroy();return {value,state,trace,frames:h.frames,rawModes:h.rawModes};
}

test("Prompt preserves editing, lifecycle, events and grapheme cursors",async()=>{
  const {Prompt}=await import("toolcraft-design-rust/prompts/interactive/core");
  assert.equal(Prompt.name,Original.name);assert.equal(Prompt.length,Original.length);
  const cases=[{}, {track:false,keys:[["y",{name:"y"}],[undefined,{name:"left"}]]}, {abort:true},
    {initial:"a👩‍👩‍👧‍👦é",keys:[[undefined,{name:"left"}],[undefined,{name:"backspace"}],["界",{name:"x"}]]},
    {initial:"ab",keys:[[undefined,{name:"home"}],[undefined,{name:"delete"}],["Z",{}],[undefined,{name:"end"}],["\x7f",{}]]},
    {initial:"abc",keys:[[undefined,{name:"left"}],[undefined,{name:"u",ctrl:true}],["more",{}],[undefined,{name:"a",ctrl:true}],[undefined,{name:"k",ctrl:true}]]},
    {columns:5,initial:"wide界 text",keys:[["\x03",{name:"c",ctrl:true}]],abort:true},
    {keys:[["\r",{name:"return"}],["x",{}]],validate:value=>value?undefined:"Required"},
    {keys:[["h",{name:"h"}],["j",{name:"j"}],[" ",{name:"space"}],["n",{name:"n"}]]}
  ];
  for(const options of cases)assert.deepEqual(await scenario(Prompt,options),await scenario(Original,options));
});

test("Prompt reads split UTF-8 and preserves non-TTY line remainders",async()=>{
  const {Prompt}=await import("toolcraft-design-rust/prompts/interactive/core");
  async function read(Base,chunks){
    const h=harness(false);class LinePrompt extends Base{promptNonTty(){return this.readNonTtyLine();}}
    const first=new LinePrompt({input:h.input,output:h.output,render:()=>""});const pending=first.prompt();
    for(const chunk of chunks)h.input.write(chunk);h.input.end();
    const values=[await pending];
    for(let i=0;i<2;i++){const next=new LinePrompt({input:h.input,output:h.output,render:()=>""});values.push(await next.prompt());}
    h.input.destroy();h.output.destroy();return values;
  }
  for(const chunks of [[Buffer.from("first\r\nsecond\nthird")],[Buffer.from([0xe7]),Buffer.from([0x95,0x8c,13]),Buffer.from("\nsecond\rthird")],[Buffer.from("one\n\ntwo")]])assert.deepEqual(await read(Prompt,chunks),await read(Original,chunks));
});

test("nonTtyPromptMessage retains argument coercion and command boundaries",async()=>{
  const {nonTtyPromptMessage}=await import("toolcraft-design-rust/prompts/interactive/core");
  for(const argv of [[],["node","cli"],["node","cli","configure","claude"],["node","cli","gaslight","--limit","1"],["node","cli",""],["node","cli","--yes"]])assert.equal(nonTtyPromptMessage(argv),originalMessage(argv));
});

test("prompt argument scanning closes iterators and preserves thrown values",async()=>{
  const {nonTtyPromptMessage}=await import("toolcraft-design-rust/prompts/interactive/core");
  function scan(fn,fail){
    const trace=[],failure={};
    const argv={slice(index){trace.push(["slice",index]);return {[Symbol.iterator](){let index=0;return {next(){trace.push("next");return {value:index++?"--yes":"configure",done:false};},return(){trace.push("return");if(fail)throw failure;return {done:true};}};}};}};
    try{return [fn(argv),trace];}catch(error){assert.equal(error,failure);return ["failed",trace];}
  }
  for(const fail of [false,true])assert.deepEqual(scan(nonTtyPromptMessage,fail),scan(originalMessage,fail));
});

test("Prompt preserves live property reads and callback receivers",async()=>{
  const {Prompt}=await import("toolcraft-design-rust/prompts/interactive/core");
  function observe(Base){
    const h=harness(),trace=[],p=new Base({input:h.input,output:h.output,initialValue:"v",initialUserInput:"abc",render(){return "frame";} });
    for(const key of ["value","userInput","_cursor","trackValue","state"]){let value=p[key];Object.defineProperty(p,key,{configurable:true,get(){trace.push(["get",key]);return value;},set(next){trace.push(["set",key,next]);value=next;}});}
    for(const key of ["emit","setUserInput"]){const method=p[key];Object.defineProperty(p,key,{configurable:true,get(){trace.push(["method",key]);return function(...args){trace.push(["call",key,this===p]);return Reflect.apply(method,this,args);};}});}
    p.setUserInput("界ab");p.updateTrackedInput(undefined,{name:"k",ctrl:true},undefined);p.updateTrackedInput("x",{},undefined);p.updateTrackedInput(undefined,{name:"backspace"},undefined);p.updateTrackedInput(undefined,{name:"home"},undefined);p.updateTrackedInput(undefined,{name:"delete"},undefined);
    p.onKeypress("y",{name:"y"});p.close();h.input.destroy();h.output.destroy();return trace;
  }
  assert.deepEqual(observe(Prompt),observe(Original));
});

test("Prompt preserves reentrant render cancellation and arbitrary render failures",async()=>{
  const {Prompt}=await import("toolcraft-design-rust/prompts/interactive/core");
  async function observe(Base,fail){
    const h=harness(),failure={},trace=[];let once=true,p;
    p=new Base({input:h.input,output:h.output,render(self){trace.push(["render",self===p,this===p,p.state]);if(fail)throw failure;if(once){once=false;p.onCancel();}return p.state;}});
    try{const value=await p.prompt();trace.push(["result",typeof value,p.state]);}catch(error){assert.equal(error,failure);trace.push(["failed",p.state]);p.renderFrame=()=>"closed";p.close();}
    trace.push(h.frames,h.rawModes,p.closed,p.previousFrame);h.input.destroy();h.output.destroy();return trace;
  }
  for(const fail of [false,true])assert.deepEqual(await observe(Prompt,fail),await observe(Original,fail));
});

test("prompt key aliases and frame wrapping preserve public helper contracts",async()=>{
  const {mapKey}=await import("toolcraft-design-rust/prompts/interactive/keys");
  const {mapKey:referenceKey}=await import("../../toolcraft-design/dist/prompts/interactive/keys.js");
  const native=await import("toolcraft-design-rust/prompts/interactive/wrap"),reference=await import("../../toolcraft-design/dist/prompts/interactive/wrap.js");
  for(const name of [undefined,"","up","enter","escape","j","constructor","__proto__","toString"])for(const char of [undefined,"","k","l"," ","\x03","constructor"])assert.equal(mapKey(name,char),referenceKey(name,char));
  for(const columns of [undefined,0,1,7,80,2.5,NaN]){
    const output={columns,rows:columns};
    assert.equal(native.getColumns(output),reference.getColumns(output));assert.equal(native.getRows(output),reference.getRows(output));
    for(const text of ["", "a👩‍👩‍👧‍👦é界\nnext", "\x1b[31mred\x1b[0m text"]){
      assert.equal(native.wrapFrame(output,text),reference.wrapFrame(output,text));
      assert.equal(native.wrapTextWithPrefix(output,text,"│ ","◆ "),reference.wrapTextWithPrefix(output,text,"│ ","◆ "));
    }
  }
});
