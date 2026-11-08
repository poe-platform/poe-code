import { expect,it } from 'vitest';
import { wavAst } from '@poe-code/mp4-ast';
import { encodeWav } from '@poe-code/audio-ast';
import { formatFfprobeResult,formatFfprobeSourceChunks } from './media.js';

const base=wavAst().probe(encodeWav({sampleRate:8000,channels:[new Float64Array(1)]}));
const options={printFormat:'json',showStreams:true,showFormat:true,showPackets:false,showFrames:false,showChapters:true,showPrograms:false};
const value='é😀,"\n\r\\\t||end';
const text={kind:'text' as const,async *chunks(){for(let i=0;i<value.length;i++)yield value[i]!;}};
for(const writer of ['json','json:compact=1','default','default=nw=1:nk=1','flat','compact','csv','csv=s=||'])it(`streams tag fields with exact ${writer} escaping`,async()=>{
  const probe={...base,streams:base.streams.map(stream=>({...stream,tags:{title:value,empty:''}})),format:{...base.format,tags:{title:value}},chapters:[{id:0,time_base:'1/1000',start:0,start_time:'0',end:1,end_time:'0.001',tags:{title:value}}]};
  const source={...probe,streams:probe.streams.map(stream=>({...stream,tags:{title:text,empty:{kind:'text' as const,async *chunks(){}}}})),format:{...probe.format,tags:{title:text}},chapters:probe.chapters.map(chapter=>({...chapter,tags:{title:text}}))};
  let output='';for await(const part of formatFfprobeSourceChunks(source,{...options,printFormat:writer}))output+=part;
  expect(output).toBe(formatFfprobeResult(probe,{...options,printFormat:writer}));
});
it('does not read filtered or unselected source text',async()=>{
  let reads=0;
  const hidden={kind:'text' as const,chunks(){reads++;throw new Error('unselected text');}};
  const source={...base,streams:base.streams.map(stream=>({...stream,tags:{title:text,hidden}})),format:{...base.format,tags:{hidden}}};
  let output='';for await(const part of formatFfprobeSourceChunks(source,{...options,showFormat:false,showEntries:'stream_tags=title'}))output+=part;
  expect(JSON.parse(output)).toEqual({streams:[{tags:{title:value}}],chapters:[]});expect(reads).toBe(0);
});
it('applies backpressure and retires text when formatting ends early',async()=>{
  let read=0,closed=0;
  const large={kind:'text' as const,async *chunks(){try{for(let i=0;i<10000;i++){read++;yield 'x'.repeat(1024);}}finally{closed++;}}};
  const iterator=formatFfprobeSourceChunks({...base,format:{...base.format,tags:{title:large}}},{...options,showStreams:false});
  let part=await iterator.next();while(!part.done&&!part.value.includes('x'.repeat(32)))part=await iterator.next();
  expect(read).toBe(1);await iterator.return(undefined);expect(closed).toBe(1);
});
for(const mode of ['read','cancel'])it(`retires rejecting text iterators and preserves ${mode} failure`,async()=>{
  const controller=new AbortController();let closed=0;
  const failing={kind:'text' as const,chunks(){return{[Symbol.asyncIterator](){return{async next(){if(mode==='cancel'){controller.abort(new Error('cancelled text'));return{done:false as const,value:'x'};}throw new Error('text failed');},async return(){closed++;throw new Error('cleanup failed');}};}};}};
  await expect((async()=>{for await(const part of formatFfprobeSourceChunks({...base,format:{...base.format,tags:{title:failing}}},{...options,showStreams:false},undefined,controller.signal))void part;})()).rejects.toThrow(mode==='cancel'?'cancelled text':'text failed');
  expect(closed).toBe(1);
});

it('quotes CSV separators split across text chunks and empty-separator empty fields',async()=>{
  for(const [separator,parts,expected] of [['||',['a|','|b'],'format||"a||b"\n'],['',[],'format""\n']] as const){
    const text={kind:'text' as const,*chunks(){yield* parts;}};
    let output='';for await(const part of formatFfprobeSourceChunks({...base,format:{...base.format,tags:{title:text}}},{...options,showStreams:false,printFormat:'csv=s='+separator,showEntries:'format_tags=title'}))output+=part;
    expect(output).toBe(expected);
  }
});
it('preserves native JSON scalar conversion inside side data',async()=>{
  const side_data_list=[{date:new Date('2026-01-01T00:00:00Z'),flag:Object(false)}];
  let output='';for await(const part of formatFfprobeSourceChunks({...base,streams:[{...base.streams[0]!,side_data_list}]},{...options,showFormat:false,showChapters:false,printFormat:'json:compact=1'}))output+=part;
  expect(JSON.parse(output).streams[0].side_data_list).toEqual([{date:'2026-01-01T00:00:00.000Z',flag:false}]);
});
