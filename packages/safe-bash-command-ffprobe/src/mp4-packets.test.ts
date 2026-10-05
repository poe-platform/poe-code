import { expect,it } from 'vitest';
import { createSyntheticMp4,probeMp4 } from '@poe-code/mp4-ast';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

for(const fragmented of [false,true])for(const route of ['explicit','automatic','stdin','stream'])it(`reads MP4 packet-only JSON through caller sources: ${route}, fragmented=${fragmented}`,async()=>{
  const bytes=createSyntheticMp4({frameCount:8,includeAudio:true,fragmented}),expected=probeMp4(bytes,{showPackets:true}).packets,base=new MemoryFileSystem();await base.writeFile('/input.mp4',bytes);
  let closed=0,output='',diagnostic='';
  const capabilities={...base.capabilities,retainedRead:route!=='stream',streamingRead:true};
  const fs=new Proxy(base,{get(target,key){
    if(key==='readFile')return()=>{throw new Error('whole input forbidden');};
    if(key==='capabilities')return capabilities;if(key==='capabilitiesFor')return async()=>capabilities;
    if(key==='openReadFile')return async()=>({stat:()=>base.stat('/input.mp4'),async read(offset:number,length:number){expect(closed).toBe(0);expect(length).toBeLessThanOrEqual(16384);return bytes.slice(offset,offset+length);},async close(){closed++;}});
    if(key==='readStream')return async function*(){try{for(let offset=0;offset<bytes.length;offset+=71)yield bytes.subarray(offset,offset+71);}finally{closed++;}};
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const args=[...(route==='explicit'?['-f','mp4']:[]),'-show_packets','-of','json',route==='stdin'?'-':'/input.mp4'];
  const result=await createFfprobeCommand().execute({command:'ffprobe',...createCommandArguments(args),cwd:'/',env:{},fs,signal:new AbortController().signal,stdin:{async *[Symbol.asyncIterator](){try{yield bytes;}finally{closed++;}}},stdout:{async write(chunk){expect(closed).toBe(1);output+=new TextDecoder().decode(chunk);}},stderr:{async write(chunk){diagnostic+=new TextDecoder().decode(chunk);}}});
  expect(result.exitCode,diagnostic).toBe(0);expect(JSON.parse(output)).toEqual({packets:expected});expect(closed).toBe(1);expect((await base.readdir('/')).map(e=>e.name)).toEqual(['input.mp4']);
});
