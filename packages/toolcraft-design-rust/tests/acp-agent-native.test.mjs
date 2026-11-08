import assert from "node:assert/strict";
import {test} from "node:test";
import * as native from "toolcraft-design-rust";
import * as original from "../../toolcraft-design/dist/index.js";

function capture(api,format,text,state){
  const lines=[];
  api.acp.withAcpWriter(line=>lines.push(line),()=>api.withOutputFormat(format,()=>api.acp.renderAgentMessage(text,state)));
  return lines;
}

test("ACP root and public modules expose the original names and shared functions",async()=>{
  assert.deepEqual(Object.keys(native.acp),Object.keys(original.acp));
  for(const path of ["index","components","plan","writer"]){
    const actual=await import(`toolcraft-design-rust/acp/${path}`);
    const expected=await import(`../../toolcraft-design/dist/acp/${path}.js`);
    assert.deepEqual(Object.keys(actual),Object.keys(expected),path);
    for(const key of Object.keys(expected)){
      assert.equal(actual[key],native.acp[key],key);
      const descriptor=Object.getOwnPropertyDescriptor(actual,key),reference=Object.getOwnPropertyDescriptor(expected,key);
      assert.deepEqual({...descriptor,value:typeof descriptor.value},{...reference,value:typeof reference.value},key);
    }
  }
  assert.equal(native.acp.renderAgentMessage.name,original.acp.renderAgentMessage.name);
  assert.equal(native.acp.renderAgentMessage.length,original.acp.renderAgentMessage.length);
});

test("agent messages preserve all states, output formats, markdown and UTF-16",()=>{
  for(const format of ["terminal","markdown","json"])
    for(const state of [undefined,"streaming","success","error"])
      for(const text of ["hello","","## Summary\n\n- café 界\n- **done**\n", "```js\nconst x = 1;\n```\n", "\ud800x\udfff", "line\n\n  ","\x1b[31mred\x1b[0m"])
        assert.deepEqual(capture(native,format,text,state),capture(original,format,text,state),`${format}/${state}`);
});

test("agent state coercion, inherited keys and failures retain reference observations",()=>{
  function observe(api,format,state){
    try{return {lines:capture(api,format,"hello",state)};}
    catch(error){return {error:[error.constructor.name,error.message]};}
  }
  for(const format of ["terminal","markdown","json"])
    for(const state of [null,"missing","toString","valueOf","constructor","hasOwnProperty","__proto__",Symbol("state"),0])
      assert.deepEqual(observe(native,format,state),observe(original,format,state),`${format}/${String(state)}`);
  function traced(api,format){
    const trace=[],text={toJSON(key){trace.push(["json",key,this===text]);return "json";},[Symbol.toPrimitive](hint){trace.push(["text",hint,this===text]);return "message";}};
    const state={[Symbol.toPrimitive](hint){trace.push(["state",hint,this===state]);return "success";}};
    const result=observeText();
    function observeText(){try{return capture(api,format,format==="terminal"?"hello":text,state);}catch(error){return [error.constructor.name,error.message];}}
    return {trace,result};
  }
  for(const format of ["terminal","markdown","json"])assert.deepEqual(traced(native,format),traced(original,format));
  const failure={failure:true};
  for(const api of [native,original]){
    assert.throws(()=>capture(api,"terminal","hello",{[Symbol.toPrimitive](){throw failure;}}),error=>error===failure);
    assert.throws(()=>api.acp.withAcpWriter(()=>{throw failure;},()=>api.withOutputFormat("terminal",()=>api.acp.renderAgentMessage("hello"))),error=>error===failure);
  }
});

test("agent writer scopes survive nested rendering and asynchronous work",async()=>{
  async function run(api){
    const lines=[];
    await api.acp.withAcpWriter(line=>{
      lines.push(line);
      if(lines.length===1)api.acp.withAcpWriter(inner=>lines.push([inner]),()=>api.withOutputFormat("json",()=>api.acp.renderAgentMessage("nested","success")));
    },async()=>{
      await Promise.resolve();
      api.withOutputFormat("markdown",()=>api.acp.renderAgentMessage("outer"));
      api.withOutputFormat("json",()=>api.acp.renderAgentMessage("after","error"));
    });
    return lines;
  }
  assert.deepEqual(await run(native),await run(original));
});
