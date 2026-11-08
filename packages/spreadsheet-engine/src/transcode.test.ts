import {expect, it} from 'vitest';
import {createEngine} from './engine.js';
import type {Workbook} from '@poe-code/spreadsheet-ast';

const input = {kind:'range' as const,source:{size:1,async read(){return Uint8Array.of(1);}}};
const operation = () => ({signal:new AbortController().signal});
const metadata:Workbook = {sheets:[{id:'s',name:'Data',cells:[]}]};

it('transcodes replayable cells without materializing a workbook and keeps backing alive through export',async()=>{
 let closed=false,reads=0,replays=0;
 const output:number[]=[];
 const engine=createEngine({codecs:[{
  id:'fixture',description:'fixture',extensions:[],
  async readSource(){throw new Error('materialized import');},
  async readWorkbookSource(_source,context){
   reads++;context.own(()=>{closed=true;});
   return {metadata,async *cells(){replays++;expect(closed).toBe(false);for(let row=0;row<600;row++)yield {row,column:0,value:{kind:'number' as const,value:row}};}};
  },
  writeStream(){throw new Error('materialized export');},
  async *writeWorkbookSource(source){
   expect(source.metadata.sheets[0]!.cells).toEqual([]);
   for await(const cell of source.cells('s')){expect(closed).toBe(false);yield Uint8Array.of(cell.row%251);}
  }
 }]});
 try{
  const result=await engine.transcode({input,destination:{kind:'stream',sink:{async write(bytes){output.push(...bytes);}}},importType:'fixture',exportType:'fixture'},operation());
  expect(result.usage).toEqual({inputBytes:1,outputBytes:600});expect(output).toEqual(Array.from({length:600},(_,i)=>i%251));
  expect(reads).toBe(1);expect(replays).toBeGreaterThan(1);expect(closed).toBe(true);
 }finally{await engine.dispose();}
});

it('preserves cached formula values instead of running load recalculation',async()=>{
 const book:Workbook={sheets:[{id:'s',name:'Data',cells:[{row:0,column:0,formula:'=1+1',formulaDirty:true,value:{kind:'number',value:7},cachedResult:{kind:'number',value:7}}]}]};
 const engine=createEngine({formulas:{async recalculate(){throw new Error('unexpected recalculation');}},codecs:[{
  id:'fixture',description:'fixture',extensions:[],async readSource(){return book;},
  async *writeStream(actual){expect(actual.sheets[0]!.cells[0]).toEqual(book.sheets[0]!.cells[0]);yield Uint8Array.of(7);}
 }]});
 try{await engine.transcode({input,destination:{kind:'stream',sink:{async write(bytes){expect([...bytes]).toEqual([7]);}}},importType:'fixture',exportType:'fixture'},operation());}
 finally{await engine.dispose();}
});

for(const mode of ['sink','cancel'] as const)it(`closes source ownership on ${mode}`,async()=>{
 let closed=0;const controller=new AbortController(),reason=new Error('stop');
 const engine=createEngine({codecs:[{id:'fixture',description:'fixture',extensions:[],async readSource(){throw new Error('materialized import');},
  async readWorkbookSource(_input,context){context.own(()=>{closed++;});return {metadata,async *cells(){yield {row:0,column:0,value:{kind:'number' as const,value:1}};}};},
  writeStream(){throw new Error('materialized export');},async *writeWorkbookSource(){yield Uint8Array.of(1);yield Uint8Array.of(2);}
 }]});
 try{await expect(engine.transcode({input,destination:{kind:'stream',sink:{async write(){if(mode==='sink')throw reason;controller.abort(reason);}}},importType:'fixture',exportType:'fixture'},{signal:controller.signal})).rejects.toThrow('stop');expect(closed).toBe(1);}
 finally{await engine.dispose();}
});
