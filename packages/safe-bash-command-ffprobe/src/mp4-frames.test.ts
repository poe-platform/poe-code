import { expect,it } from 'vitest';
import { createSyntheticMp4,probeMp4 } from '@poe-code/mp4-ast';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand, formatFfprobeResult } from './media.js';
for(const fragmented of [false,true])for(const route of ['explicit','automatic','stdin','stream'])for(const selected of [false,true])for(const mixed of [false,true])it(`native MP4 frame source ${route}, fragmented=${fragmented},selected=${selected},mixed=${mixed}`,async()=>{
  const bytes=createSyntheticMp4({frameCount:4,includeAudio:true,channels:1,fragmented}),expected=probeMp4(bytes,{showFrames:true,showPackets:mixed}),base=new MemoryFileSystem();await base.writeFile('/input.mp4',bytes);
  let closed=0,output='',diagnostic='';
  const capabilities={...base.capabilities,retainedRead:route!=='stream',streamingRead:true};
  const fs=new Proxy(base,{get(target,key){
    if(key==='readFile')return()=>{throw new Error('whole input forbidden');};
    if(key==='capabilities')return capabilities;if(key==='capabilitiesFor')return async()=>capabilities;
    if(key==='openReadFile')return async()=>({stat:()=>base.stat('/input.mp4'),async read(offset:number,length:number){expect(closed).toBe(0);expect(length).toBeLessThanOrEqual(16384);return bytes.slice(offset,offset+length);},async close(){closed++;}});
    if(key==='readStream')return async function*(){try{for(let offset=0;offset<bytes.length;offset+=71)yield bytes.subarray(offset,offset+71);}finally{closed++;}};
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const args=[...(route==='explicit'?['-f','mp4']:[]),...(mixed?['-show_packets']:[]),...(selected?['-show_entries','frame=stream_index,pts,pkt_size']:['-show_frames']),'-of','json',route==='stdin'?'-':'/input.mp4'];
  const result=await createFfprobeCommand().execute({command:'ffprobe',...createCommandArguments(args),cwd:'/',env:{},fs,signal:new AbortController().signal,stdin:{async *[Symbol.asyncIterator](){try{yield bytes;}finally{closed++;}}},stdout:{async write(chunk){expect(closed).toBe(1);output+=new TextDecoder().decode(chunk);}},stderr:{async write(chunk){diagnostic+=new TextDecoder().decode(chunk);}}});
  expect(result.exitCode,diagnostic).toBe(0);expect(JSON.parse(output)).toEqual({...(mixed?{packets:expected.packets}:{}),frames:selected?expected.frames?.map(({stream_index,pts,pkt_size})=>({stream_index,pts,pkt_size})):JSON.parse(JSON.stringify(expected.frames))});expect(closed).toBe(1);expect((await base.readdir('/')).map(e=>e.name)).toEqual(['input.mp4']);
});

for(const writer of ['default','csv','compact','flat'])it(`formats selected frame fields with ${writer}`,()=>{
  const probe=probeMp4(createSyntheticMp4({frameCount:1,includeAudio:false}),{showFrames:true});
  const output=formatFfprobeResult(probe,{printFormat:writer,showFormat:false,showStreams:false,showFrames:true,showPackets:false,showChapters:false,showPrograms:false,showEntries:'frame=stream_index,pts,pkt_size'});
  const size=probe.frames![0]!.pkt_size;
  const expected=writer==='csv'?`frame,0,0,${size}\n`:writer==='compact'?`frame|stream_index=0|pts=0|pkt_size=${size}\n`:writer==='flat'?`frames.frame.0.stream_index=0\nframes.frame.0.pts=0\nframes.frame.0.pkt_size="${size}"\n`:`[FRAME]\nstream_index=0\npts=0\npkt_size=${size}\n[/FRAME]\n`;
  expect(output).toBe(expected);
});
