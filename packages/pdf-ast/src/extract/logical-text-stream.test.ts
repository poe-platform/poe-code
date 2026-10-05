import {expect,it} from 'vitest';
import {createMemoryFileSystem} from '@poe-code/safe-fs';
import type {PdfDisplayList,PdfPlacedGlyph} from '../ast.js';
import {PdfRawTextIndex} from './raw-text-index.js';
import {extractPageFromDisplayList,formatExtractedPageText} from './text.js';
import {streamLogicalTextChunks} from './logical-text-stream.js';
const glyph=(unicode:string,x:number,y:number):PdfPlacedGlyph=>({unicode,charCode:65,bbox:[x,y,x+5,y+10],baselineY:y,advanceWidth:5,matrix:[1,0,0,1,x,y],fontSize:10,fontName:'Helvetica',color:{r:0,g:0,b:0}});
for(const rejoinHyphens of [true,false])it(`streams indexed logical text with hyphen joining=${rejoinHyphens}`,async()=>{
 const glyphs=[glyph('right',150,80),glyph('hyphen-',0,80),glyph('ation',0,65),glyph('next',150,65),glyph('😀'.repeat(8192),0,30)];
 const display:PdfDisplayList={pageIndex:0,width:200,height:200,rotation:0,glyphs,paths:[],images:[],operations:[],annotations:[]};
 const expected=formatExtractedPageText(extractPageFromDisplayList(display,{mode:'logical'}),{mode:'logical',rejoinHyphens});
 const fs=createMemoryFileSystem();await fs.mkdir('/scratch');const index=await PdfRawTextIndex.create(glyphs,{fs,directory:'/scratch'},{mode:'logical',pageWidth:200});
 try{const decoder=new TextDecoder();let result='';for await(const bytes of streamLogicalTextChunks(index,{chunkBytes:17,rejoinHyphens})){expect(bytes.byteLength).toBeLessThanOrEqual(17);result+=decoder.decode(bytes,{stream:true});await Promise.resolve();}expect(result+decoder.decode()).toBe(expected);}finally{await index.close();}
 expect(await fs.readdir('/scratch')).toEqual([]);
});
it('crops complete words while preserving surviving block separators',async()=>{
 const fs=createMemoryFileSystem();await fs.mkdir('/scratch');const index=await PdfRawTextIndex.create([glyph('hyphen-',0,80),glyph('skip',100,65),glyph('ation',0,50)],{fs,directory:'/scratch'});
 try{let result='';for await(const bytes of streamLogicalTextChunks(index,{crop:[0,0,20,100]}))result+=new TextDecoder().decode(bytes);expect(result).toBe('hyphen-\n\nation');}finally{await index.close();}
});
it('admits output scratch before reading and preserves cancellation identity',async()=>{
 const reason=new Error('cancelled'),controller=new AbortController();let pulls=0;
 const index={blocks():ReturnType<PdfRawTextIndex['blocks']>{pulls++;throw reason;}};
 await expect(async()=>{for await(const ignored of streamLogicalTextChunks(index,{maxWorkingBytes:0})){void ignored;}}).rejects.toMatchObject({code:'E_LIMIT'});expect(pulls).toBe(0);
 controller.abort(reason);await expect(async()=>{for await(const ignored of streamLogicalTextChunks(index,{signal:controller.signal})){void ignored;}}).rejects.toBe(reason);expect(pulls).toBe(0);
});
it('retires active word and hierarchy iterators after an early return',async()=>{
 let closed=0;const index={async *blocks(){try{yield {kind:'paragraph' as const,bbox:[0,0,5,10] as const,async *lines(){try{yield {bbox:[0,0,5,10] as const,baselineY:0,async *words(){try{yield {bbox:[0,0,5,10] as const,fontSize:10,async *text(){try{yield 'a'.repeat(4096);}finally{closed++;}}};}finally{closed++;}}};}finally{closed++;}}};}finally{closed++;}}};
 const stream=streamLogicalTextChunks(index,{chunkBytes:16});await stream.next();await stream.return();expect(closed).toBe(4);
});
