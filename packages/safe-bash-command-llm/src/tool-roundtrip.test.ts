import assert from 'node:assert/strict';
import test from 'node:test';
import {toByteSource} from 'safe-bash-contracts';
import {createOpenAiProvider} from './openai.js';
import {createLlmService} from './service.js';
import type {LlmMessage, LlmSourceAttachment, LlmInputSource, LlmSourceRequest} from './types.js';
import {chatJson} from './chat-json.js';
import fixtures from './fixtures/tool-roundtrip-0.27.1.json' with {type:'json'};
import type {LlmToolCall} from './types.js';

for(const [index,fixture] of fixtures.entries())for(const source of [false,true])test(`pinned tool roundtrip ${index}, source=${source}`,async()=>{
  let body:unknown,disposed=0;
  const provider=createOpenAiProvider({apiKey:'fixture',models:[{id:'fixture',endpoint:'chat',capabilities:['messages','tools']}],transport:async request=>{
    let text='';for await(const bytes of request.body!)text+=new TextDecoder().decode(bytes);body=JSON.parse(text);
    return {status:200,statusText:'OK',headers:[],body:toByteSource(JSON.stringify({choices:[{message:{content:fixture.output}}]})),async dispose(){}};
  }});
  const messages:LlmMessage[]=fixture.request.messages.slice(0,fixture.prompt?-1:undefined).map(message=>({role:message.role as LlmMessage['role'],content:message.content??'',
    ...(message.tool_calls?{toolCalls:message.tool_calls.map(call=>({id:call.id,name:call.function.name,arguments:JSON.parse(call.function.arguments)}))}:{}),
    ...(message.tool_call_id?{toolCallId:message.tool_call_id}:{}),
  }));
  const request={model:'fixture',prompt:fixture.prompt,messages,attachments:[],options:{},stream:false,signal:new AbortController().signal,
    tools:fixture.request.tools.map(tool=>({name:tool.function.name,description:tool.function.description,inputSchema:tool.function.parameters}))};
  const input=(value:string):LlmInputSource=>({bytes:toByteSource(value),async dispose(){disposed++;}});
  const service=createLlmService({providers:[provider]});let output='';
  const converted:LlmMessage<LlmInputSource,LlmSourceAttachment>[]=messages.map(message=>({...message,content:input(message.content),attachments:[]}));
  for await(const event of source?service.streamSources!({...request,prompt:input(fixture.prompt),messages:converted}):service.stream(request))if(event.type==='text')output+=event.text;
  assert.deepEqual(body,fixture.request);assert.equal(output,fixture.output);assert.equal(disposed,source?messages.length+1:0);
});

test('the caller can complete a tool roundtrip without the service retaining its messages',async()=>{
  const bodies:Record<string,unknown>[]=[];
  const provider=createOpenAiProvider({apiKey:'fixture',models:[{id:'fixture',endpoint:'chat',capabilities:['messages','tools']}],transport:async request=>{
    let text='';for await(const bytes of request.body!)text+=new TextDecoder().decode(bytes);bodies.push(JSON.parse(text));
    const message=bodies.length===1?{role:'assistant',content:null,tool_calls:[{id:'call',type:'function',function:{name:'clock',arguments:'{}'}}]}:{role:'assistant',content:'It is noon'};
    return {status:200,statusText:'OK',headers:[],body:toByteSource(JSON.stringify({choices:[{message}]})),async dispose(){}};
  }});
  const service=createLlmService({providers:[provider]});
  const request={model:'fixture',prompt:'What time is it?',tools:[{name:'clock',inputSchema:{}}],attachments:[],options:{},stream:false,signal:new AbortController().signal};
  let toolCalls:readonly LlmToolCall[]=[];
  for await(const event of service.stream(request))if(event.type==='response')toolCalls=event.response.toolCalls??[];
  assert.equal(toolCalls[0]?.name,'clock');
  const messages:LlmMessage[]=[{role:'user',content:request.prompt},{role:'assistant',content:'',toolCalls},{role:'tool',toolCallId:toolCalls[0]!.id!,content:'12:00'}];
  let answer='';for await(const event of service.stream({...request,prompt:'',messages}))if(event.type==='text')answer+=event.text;
  assert.equal(answer,'It is noon');assert.equal((bodies[1]!.messages as unknown[]).length,3);
  for await(const ignored of service.stream({...request,prompt:'Fresh question'})){ /* Consume the independent request. */ }
  assert.deepEqual(bodies[2]!.messages,[{role:'user',content:'Fresh question'}]);
});

test('large tool output and nested call arguments stream with bounded writes and backpressure',async()=>{
  const signal=new AbortController().signal;
  let emitted=0,pulled=0,returned=0;
  const empty=():LlmInputSource=>({bytes:toByteSource(''),async dispose(){}});
  const result:LlmInputSource={bytes:{async *[Symbol.asyncIterator](){try{
    const slab=new Uint8Array(8192).fill(90);
    for(let index=0;index<128;index++){
      assert.equal(emitted,index*slab.length,'previous source chunk must reach the sink before pulling again');
      pulled++;yield slab;
    }
  }finally{returned++;}}},async dispose(){}};
  const request:LlmSourceRequest={model:'fixture',prompt:empty(),attachments:[],options:{},signal,messages:[
    {role:'assistant',content:empty(),toolCalls:[{id:'call',name:'tool',arguments:{large:'😀\\"'.repeat(10000)}}]},
    {role:'tool',toolCallId:'call',content:result},
  ]};
  for await(const bytes of chatJson(request,4*1024*1024)){
    assert.ok(bytes.length<=16384,`oversized wire chunk: ${bytes.length}`);
    for(const byte of bytes)if(byte===90)emitted++;
  }
  assert.equal(emitted,1048576);assert.equal(pulled,128);assert.equal(returned,1);
});

for(const message of [
  {role:'tool',content:'result'},
  {role:'user',content:'result',toolCallId:'call'},
  {role:'tool',content:'result',toolCallId:'call',attachments:[{mimeType:'text/plain',bytes:new Uint8Array()}]},
  {role:'user',content:'result',toolCalls:[{name:'tool',arguments:{}}]},
])test(`invalid tool message is rejected before provider dispatch ${JSON.stringify(message)}`,async()=>{
  let calls=0;
  const service=createLlmService({providers:[{name:'fixture',models:[{id:'fixture',capabilities:['messages','tools']}],async *complete(){calls++;yield 'unexpected';}}]});
  await assert.rejects(async()=>{for await(const ignored of service.stream({model:'fixture',prompt:'',messages:[message as LlmMessage],attachments:[],options:{},signal:new AbortController().signal})){ /* Consume. */ }},/tool|assistant/);
  assert.equal(calls,0);
});

test('tool messages need model capability even when no definitions are supplied',async()=>{
  const service=createLlmService({providers:[{name:'fixture',models:[{id:'fixture',capabilities:['messages']}],async *complete(){yield assert.fail('provider called');}}]});
  await assert.rejects(async()=>{for await(const ignored of service.stream({model:'fixture',prompt:'',messages:[{role:'tool',content:'result',toolCallId:'call'}],attachments:[],options:{},signal:new AbortController().signal})){ /* Consume. */ }},/does not support tools/);
});

test('cancelling a pending tool-result read releases each caller lease once',async()=>{
  const controller=new AbortController(),reason=new Error('cancel result');
  let disposed=0,unblock:()=>void=()=>{};
  const pending=new Promise<void>(resolve=>{unblock=resolve;});
  const result:LlmInputSource={bytes:{async *[Symbol.asyncIterator](){controller.abort(reason);await pending;yield new Uint8Array();}},async dispose(){disposed++;unblock();}};
  const provider=createOpenAiProvider({apiKey:'fixture',models:[{id:'fixture',endpoint:'chat',capabilities:['messages','tools']}],transport:async request=>{
    for await(const ignored of request.body!){ /* Read until cancellation. */ }
    return assert.fail('transport completed despite cancellation');
  }});
  const service=createLlmService({providers:[provider]});
  await assert.rejects(async()=>{for await(const ignored of service.streamSources!({model:'fixture',prompt:result,messages:[{role:'tool',toolCallId:'call',content:result}],attachments:[],options:{},signal:controller.signal})){ /* Consume. */ }},error=>error===reason);
  assert.equal(disposed,1);
});

test('empty tool-result chunks yield cooperatively while discovering content',async()=>{
  const controller=new AbortController(),reason=new Error('empty result cancelled');let returned=0;
  const content:LlmInputSource={bytes:{async *[Symbol.asyncIterator](){try{while(true)yield new Uint8Array();}finally{returned++;}}},async dispose(){}};
  const timer=setTimeout(()=>controller.abort(reason),0);
  try {
    await assert.rejects(async()=>{for await(const ignored of chatJson({model:'fixture',prompt:content,messages:[{role:'tool',toolCallId:'call',content}],attachments:[],options:{},signal:controller.signal},Infinity)){ /* Consume until abort. */ }},error=>error===reason);
    assert.equal(returned,1);
  }finally{clearTimeout(timer);}
});

for(const malformed of [false,true])test(`tool source retirement on ${malformed?'invalid UTF-8':'wire quota'}`,async()=>{
  let disposed=0,returned=0;
  const input:LlmInputSource={bytes:{async *[Symbol.asyncIterator](){try{yield malformed?Uint8Array.of(255):new Uint8Array(10000).fill(97);}finally{returned++;}}},async dispose(){disposed++;}};
  const provider=createOpenAiProvider({apiKey:'fixture',models:[{id:'fixture',endpoint:'chat',capabilities:['messages','tools']}],limits:{maxRequestBytes:512},transport:async request=>{
    for await(const ignored of request.body!){ /* Read until rejection. */ }
    return assert.fail('invalid body completed');
  }});
  const service=createLlmService({providers:[provider]});
  await assert.rejects(async()=>{for await(const ignored of service.streamSources!({model:'fixture',prompt:input,messages:[{role:'tool',toolCallId:'call',content:input}],attachments:[],options:{},signal:new AbortController().signal})){ /* Consume. */ }});
  assert.equal(disposed,1);assert.equal(returned,1);
});
