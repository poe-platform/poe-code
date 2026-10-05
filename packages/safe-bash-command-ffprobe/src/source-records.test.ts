import { expect, it } from 'vitest';
import { wavAst, type MediaAstPlugin } from '@poe-code/mp4-ast';
import { encodeWav } from '@poe-code/audio-ast';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import * as command from './media.js';

const bytes=encodeWav({sampleRate:8000,channels:[new Float64Array(2500)]});
const probe=wavAst().probe(bytes,{showPackets:true,showFrames:true});
const opts={printFormat:'json',showFormat:true,showStreams:true,showPackets:true,showFrames:true,showChapters:true,showPrograms:true};
async function* rows<T>(values:Iterable<T>){yield* values;}
it.each(['json','json:compact=1','default','csv','compact','flat'])('formats asynchronous record sources with %s parity',async printFormat=>{
  expect(typeof command.formatFfprobeSourceChunks).toBe('function');
  let text='';for await(const part of command.formatFfprobeSourceChunks({...probe,streams:rows(probe.streams),packets:rows(probe.packets!),frames:rows(probe.frames!),chapters:rows(probe.chapters)},{...opts,printFormat}))text+=part;
  expect(text).toBe(command.formatFfprobeResult(probe,{...opts,printFormat}));
});
it.each(['default','csv','compact','flat'])('yields %s before enumerating the next stream',printFormat=>{
  let read=0,closed=0;
  function* streams(){try{for(let i=0;i<10000;i++){read++;yield {...probe.streams[0]!,index:i};}}finally{closed++;}}
  const parts=command.formatFfprobeResultChunks({...probe,streams:streams()},{...opts,printFormat,showPackets:false,showFrames:false});
  const first=parts.next();expect(first.done).toBe(false);expect(read).toBe(1);parts.return(undefined);expect(closed).toBe(1);
});
it.each(['success','read','close','cancel'])('keeps caller input alive for lazy source records: %s',async mode=>{
  const base=new MemoryFileSystem();await base.writeFile('/input.wav',bytes);
  const controller=new AbortController();let closed=0,output='',diagnostic='',retired=0;
  const fs=new Proxy(base,{get(target,key){
    if(key==='openReadFile')return async()=>({stat:()=>base.stat('/input.wav'),async read(offset:number,length:number){if(closed)throw new Error('premature close');if(mode==='read')throw new Error('late read');if(mode==='cancel')controller.abort(new Error('cancelled lazy read'));return bytes.slice(offset,offset+length);},async close(){closed++;if(mode==='close')throw new Error('close failed');}});
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const plugin:MediaAstPlugin={...wavAst(),async probeRecords(source){return {...probe,streams:(async function*(){try{await source.read(0,4);yield probe.streams[0]!;}finally{retired++;}})()};}};
  let error:unknown;
  const result=await Promise.resolve(command.createFfprobeCommand({asts:[plugin]}).execute({command:'ffprobe',...createCommandArguments(['-f','wav','-of','json','-show_streams','/input.wav']),cwd:'/',env:{},fs,signal:controller.signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(chunk){expect(closed).toBe(1);output+=new TextDecoder().decode(chunk);}},stderr:{async write(chunk){diagnostic+=new TextDecoder().decode(chunk);}}})).catch(reason=>{error=reason;});
  expect(closed).toBe(1);expect(retired).toBe(1);
  if(mode==='success'){expect(result?.exitCode,diagnostic).toBe(0);expect(JSON.parse(output)).toEqual({streams:probe.streams});}
  else {expect(output).toBe('');if(mode==='cancel')expect(error).toEqual(new Error('cancelled lazy read'));else expect(diagnostic).toContain(mode==='read'?'late read':'close failed');}
});
it('retires a rejecting record iterator and preserves the read failure over cleanup',async()=>{
  let retired=0;
  const streams={ [Symbol.asyncIterator](){return {async next(){throw new Error('enumeration failed');},async return(){retired++;throw new Error('retirement failed');}};}};
  await expect((async()=>{for await(const part of command.formatFfprobeSourceChunks({...probe,streams},opts))void part;})()).rejects.toThrow('enumeration failed');
  expect(retired).toBe(1);
});
it('closes plugin backing even when its record sections are not selected',async()=>{
  const fs=new MemoryFileSystem();await fs.writeFile('/input.wav',bytes);let closed=0;
  const plugin:MediaAstPlugin={...wavAst(),async probeRecords(){return {...probe,async close(){closed++;},streams:{[Symbol.asyncIterator](){throw new Error('unselected records');}}};}};
  const result=await command.createFfprobeCommand({asts:[plugin]}).execute({command:'ffprobe',...createCommandArguments(['-show_format','/input.wav']),cwd:'/',env:{},fs,signal:new AbortController().signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(){expect(closed).toBe(1);}},stderr:{async write(){throw new Error('unexpected diagnostic');}}});
  expect(result.exitCode).toBe(0);expect(closed).toBe(1);
});
it.each(['automatic','stdin'])('uses lazy record hooks for %s input',async mode=>{
  const fs=new MemoryFileSystem();await fs.writeFile('/input.wav',bytes);let output='',calls=0;
  const plugin:MediaAstPlugin={...wavAst(),async probeRecords(source){expect(this).toBe(plugin);calls++;return {...probe,streams:(async function*(){expect(await source.read(0,4)).toEqual(bytes.subarray(0,4));yield probe.streams[0]!;})()};}};
  const result=await command.createFfprobeCommand({asts:[plugin]}).execute({command:'ffprobe',...createCommandArguments(['-of','json','-show_entries','stream=index',mode==='stdin'?'-':'/input.wav']),cwd:'/',env:{},fs,signal:new AbortController().signal,stdin:{async *[Symbol.asyncIterator](){yield bytes;}},stdout:{async write(chunk){output+=new TextDecoder().decode(chunk);}},stderr:{async write(){throw new Error('unexpected diagnostic');}}});
  expect(result.exitCode).toBe(0);expect(calls).toBe(1);expect(JSON.parse(output)).toEqual({streams:[{index:0}]});expect((await fs.readdir('/')).map(entry=>entry.name)).toEqual(['input.wav']);
});
it('selects and counts streams incrementally with legacy ordinal and tag formatting',async()=>{
  const streams=[{...probe.streams[0]!,index:8},{...probe.streams[0]!,index:4,tags:{title:'é,"\n'}}];
  let output='';for await(const part of command.formatFfprobeSourceChunks({...probe,streams:rows(streams)},{...opts,printFormat:'csv',showFormat:false,showPackets:false,showFrames:false,selectStreams:'a:1',showEntries:'stream=index,nb_read_packets:stream_tags=title',countPackets:true}))output+=part;
  expect(output).toBe('stream,4,"é,""\n",3\n');
});

it.each(['default','csv','compact','flat'])('yields %s before enumerating the next packet',async printFormat=>{
  let read=0,closed=0;
  async function* packets(){try{for(let i=0;i<10000;i++){read++;yield {...probe.packets![0]!,pts:i};}}finally{closed++;}}
  const parts=command.formatFfprobeSourceChunks({...probe,packets:packets()},{...opts,printFormat});
  const first=await parts.next();expect(first.done).toBe(false);expect(read).toBe(1);await parts.return(undefined);expect(closed).toBe(1);
});
