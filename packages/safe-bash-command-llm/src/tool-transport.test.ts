import assert from 'node:assert/strict';
import test from 'node:test';
import {toByteSource} from 'safe-bash-contracts';
import {createLlmService} from './service.js';
import {createOpenAiProvider} from './openai.js';
import fixtures from './fixtures/tool-transport-0.27.1.json' with {type:'json'};
import type {LlmRequest} from './types.js';
import {openAiChat} from './openai-sse.js';

for (const [index, fixture] of fixtures.entries()) for (const sources of [false, true]) {
  test(`pinned tool transport ${index}, sources=${sources}`, async () => {
    let body: unknown, disposed = 0, released = 0;
    const provider = createOpenAiProvider({apiKey:'fixture', models:[{id:'fixture',endpoint:'chat',capabilities:['tools']}], transport:async request => {
      let text='';for await(const bytes of request.body!)text+=new TextDecoder().decode(bytes);body=JSON.parse(text);
      return {status:200,statusText:'OK',headers:[],body:toByteSource(fixture.stream
        ? fixture.events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n'
        : JSON.stringify(fixture.response)), async dispose(){disposed++;}};
    }});
    const service = createLlmService({providers:[provider]});
    const request = {model:'fixture',prompt:'Question',options:{},attachments:[],signal:new AbortController().signal,stream:fixture.stream,
      tools:fixture.request.tools.map(tool=>({name:tool.function.name,description:tool.function.description,inputSchema:tool.function.parameters}))};
    const events = [];
    for await (const event of sources ? service.streamSources!({...request,prompt:{bytes:toByteSource('Question'),async dispose(){released++;}}}) : service.stream(request)) events.push(event);
    assert.deepEqual(body,fixture.request);
    assert.equal(events.filter(event=>event.type==='text').map(event=>event.text).join(''),fixture.text);
    const response=events.find(event=>event.type==='response');
    assert.deepEqual(response?.response.toolCalls,fixture.toolCalls.map(call=>({id:call.tool_call_id,name:call.name,arguments:call.arguments})));
    assert.equal(disposed,1);assert.equal(released,sources?1:0);
  });
}

test('tools require explicit capability and valid JSON schemas before dispatch', async () => {
  let calls=0;
  for(const capable of [false,true]) {
    const service=createLlmService({providers:[{name:'fixture',models:[{id:'fixture',capabilities:capable?['tools']:[]}],async *complete(){calls++;yield 'unexpected';}}]});
    const tool={name:'weather',inputSchema:capable?{bad:Infinity}:{}};
    const request={model:'fixture',prompt:'',attachments:[],options:{},tools:[tool],signal:new AbortController().signal};
    await assert.rejects(async()=>{for await(const ignoredEvent of service.stream(request)){ /* Consume until completion or rejection. */ }},capable?/finite JSON/:/does not support tools/);
  }
  assert.equal(calls,0);
});

test('rejected source tools dispose their leases without acquisition', async () => {
  let disposed=0;
  const service=createLlmService({providers:[{name:'fixture',models:[{id:'fixture'}],async *complete(){yield* [];},async *completeSources(){yield assert.fail('provider called');}}]});
  const request={model:'fixture',prompt:{bytes:{async *[Symbol.asyncIterator](){yield assert.fail('input read');}},async dispose(){disposed++;}},attachments:[],options:{},tools:[{name:'clock',inputSchema:{}}],signal:new AbortController().signal};
  await assert.rejects(async()=>{for await(const ignoredEvent of service.streamSources!(request)){ /* Consume until completion or rejection. */ }},/does not support tools/);
  assert.equal(disposed,1);
});

function event(tool_calls: unknown): string {
  return 'data: '+JSON.stringify({choices:[{delta:{tool_calls}}]})+'\n\n';
}

test('tool control quota covers the complete interleaved stream, not one event', async()=>{
  let returned=0;
  const data=event([{index:0,id:'call',type:'function',function:{name:'weather',arguments:'{"city":"'}}])+event([{index:0,function:{arguments:'é'.repeat(30)+'"}'}}])+'data: [DONE]\n\n';
  const source={async *[Symbol.asyncIterator](){try{yield new TextEncoder().encode(data);}finally{returned++;}}};
  await assert.rejects(async()=>{for await(const ignoredText of openAiChat(source,new AbortController().signal,1024,4096,32)){ /* Consume until completion or rejection. */ }},/tool call byte limit/);
  assert.equal(returned,1);
});

for(const argumentsText of ['{','{"value":1e500}']) test(`rejects malformed or nonfinite tool arguments ${argumentsText}`,async()=>{
  const data=event([{index:0,id:'call',type:'function',function:{name:'clock',arguments:argumentsText}}])+'data: [DONE]\n\n';
  await assert.rejects(async()=>{for await(const ignoredText of openAiChat(toByteSource(data),new AbortController().signal)){ /* Consume until completion or rejection. */ }},/arguments are not valid JSON/);
});

for(const call of [
  {index:-1,function:{name:'clock',arguments:'{}'}},
  {index:0,id:'call',function:{arguments:'{}'}},
  {index:0,id:'call',type:'custom',function:{name:'clock',arguments:'{}'}},
  {index:0,id:'call',function:{name:'clock',arguments:7}},
]) test(`rejects malformed tool identity ${JSON.stringify(call)}`,async()=>{
  await assert.rejects(async()=>{for await(const ignoredText of openAiChat(toByteSource(event([call])+'data: [DONE]\n\n'),new AbortController().signal)){ /* Consume until completion or rejection. */ }},/tool call/);
});

test('tool calls share the service output budget and survive text-free completions',async()=>{
  const toolCalls=[{id:'call',name:'clock',arguments:{}}];
  const service=createLlmService({providers:[{name:'fixture',models:[{id:'fixture'}],async *complete(){yield* [];return {toolCalls};}}]});
  const request:LlmRequest={model:'fixture',prompt:'',attachments:[],options:{},signal:new AbortController().signal};
  await assert.rejects(async()=>{for await(const ignoredEvent of service.stream({...request,maxOutputBytes:1})){ /* Consume until completion or rejection. */ }},/output byte limit/);
  const events=[];for await(const value of service.stream(request))events.push(value);
  assert.deepEqual(events,[{type:'response',response:{model:'fixture',toolCalls}}]);
});

test('only the first completion choice contributes tool calls and text',async()=>{
  const first={index:0,id:'first',type:'function',function:{name:'clock',arguments:'{}'}};
  const other={index:0,id:'second',type:'function',function:{name:'clock',arguments:'{}'}};
  const bytes=toByteSource('data: '+JSON.stringify({choices:[{delta:{content:'first',tool_calls:[first]}},{delta:{content:'second',tool_calls:[other]}}]})+'\n\ndata: [DONE]\n\n');
  const iterator=openAiChat(bytes,new AbortController().signal);
  assert.deepEqual(await iterator.next(),{done:false,value:'first'});
  assert.deepEqual(await iterator.next(),{done:true,value:{toolCalls:[{id:'first',name:'clock',arguments:{}}]}});
});

test('streamed tool arguments survive byte-split UTF-8 and interleaved indices',async()=>{
  const fixture=fixtures[3]!;
  const bytes=new TextEncoder().encode(fixture.events.map(value=>'data: '+JSON.stringify(value)+'\n\n').join('')+'data: [DONE]\n\n');
  const source={async *[Symbol.asyncIterator](){for(const byte of bytes)yield Uint8Array.of(byte);}};
  const iterator=openAiChat(source,new AbortController().signal);
  let next=await iterator.next();while(!next.done)next=await iterator.next();
  assert.deepEqual(next.value.toolCalls,fixture.toolCalls.map(call=>({id:call.tool_call_id,name:call.name,arguments:call.arguments})));
});

for(const sources of [false,true]) test(`tool response controls obey provider quota, sources=${sources}`,async()=>{
  let disposed=0;
  const fixture=fixtures[0]!;
  const provider=createOpenAiProvider({apiKey:'fixture',models:[{id:'fixture',endpoint:'chat',capabilities:['tools']}],limits:{maxToolCallBytes:8},transport:async()=>({status:200,statusText:'OK',headers:[],body:toByteSource(JSON.stringify(fixture.response)),async dispose(){disposed++;}})});
  const request={model:'fixture',prompt:'Question',stream:false,options:{},attachments:[],signal:new AbortController().signal};
  const output=sources?provider.completeSources!({...request,prompt:{bytes:toByteSource('Question'),async dispose(){}}}):provider.complete(request);
  await assert.rejects(async()=>{for await(const ignoredText of output){ /* Consume the response. */ }},/tool call byte limit/);
  assert.equal(disposed,1);
});

test('cancellation retires an incomplete tool stream and its HTTP response',async()=>{
  const controller=new AbortController(), reason=new Error('stop tool response');
  let disposed=0,returned=0,unblock:()=>void=()=>{};
  const pending=new Promise<void>(resolve=>{unblock=resolve;});
  const provider=createOpenAiProvider({apiKey:'fixture',models:[{id:'fixture',endpoint:'chat'}],transport:async()=>({status:200,statusText:'OK',headers:[],body:{async *[Symbol.asyncIterator](){try{
    yield new TextEncoder().encode(event([{index:0,id:'call',function:{name:'clock',arguments:'{'}}]));
    controller.abort(reason);await pending;
  }finally{returned++;}}},async dispose(){disposed++;unblock();}})});
  const service=createLlmService({providers:[provider]});
  await assert.rejects(async()=>{for await(const ignoredEvent of service.stream({model:'fixture',prompt:'',options:{},attachments:[],signal:controller.signal})){assert.fail('incomplete tool calls escaped');}},error=>error===reason);
  assert.equal(disposed,1);assert.equal(returned,1);
});
