import {expect,it} from 'vitest';
import {createMemoryFileSystem} from '@poe-code/safe-fs';
import type {PdfDisplayList,PdfPlacedGlyph} from '../ast.js';
import {PdfRawTextIndex} from './raw-text-index.js';
import {extractPageFromDisplayList,formatExtractedPageText} from './text.js';
const glyph=(unicode:string,x:number,y:number):PdfPlacedGlyph=>({unicode,charCode:65,bbox:[x,y,x+5,y+10],baselineY:y,advanceWidth:5,matrix:[1,0,0,1,x,y],fontSize:10,fontName:'Helvetica',color:{r:0,g:0,b:0}});
for(const fixedPitch of [undefined,5])for(const lineSpacing of [undefined,10])it(`streams layout spacing: pitch=${fixedPitch}, lines=${lineSpacing}`,async()=>{
 const glyphs=[glyph('right',150,80),glyph('left',0,80),glyph('next',10,50),glyph('row\t  ',160,50),glyph('😀'.repeat(2048)+' \t'.repeat(8192),0,10)];
 const display:PdfDisplayList={pageIndex:0,width:200,height:200,rotation:0,glyphs,paths:[],images:[],operations:[],annotations:[]};
 const options={mode:'layout' as const,fixedPitch,lineSpacing};const expected=formatExtractedPageText(extractPageFromDisplayList(display,options),options);
 const fs=createMemoryFileSystem();await fs.mkdir('/scratch');const index=await PdfRawTextIndex.create(glyphs,{fs,directory:'/scratch'},options);
 try{let output='';for await(const part of index.layoutText(options)){expect(part.length).toBeLessThanOrEqual(2049);output+=part;await Promise.resolve();}expect(output).toBe(expected);}finally{await index.close();}
 expect(await fs.readdir('/scratch')).toEqual([]);
});
it('recomputes cropped row bounds and left margin',async()=>{
 const fs=createMemoryFileSystem();await fs.mkdir('/scratch');const index=await PdfRawTextIndex.create([glyph('left',0,80),glyph('right',150,80),glyph('next',10,50)],{fs,directory:'/scratch'},{mode:'layout'});
 try{let result='';for await(const part of index.layoutText({crop:[0,0,20,100]}))result+=part;expect(result).toBe('left\n  next');}finally{await index.close();}expect(await fs.readdir('/scratch')).toEqual([]);
});
it('admits all layout caches and retires scratch after early output cancellation',async()=>{
 const fs=createMemoryFileSystem();await fs.mkdir('/scratch');const storage={fs,directory:'/scratch'};
 const limited=await PdfRawTextIndex.create([glyph('a',0,80)],storage,{maxWorkingBytes:81920});
 try{await expect(async()=>{for await(const ignored of limited.layoutText()){void ignored;}}).rejects.toMatchObject({code:'E_LIMIT'});}finally{await limited.close();}
 const index=await PdfRawTextIndex.create([glyph('a',0,80),glyph('b',150,80),glyph('c',0,60)],storage,{mode:'layout'});
 const stream=index.layoutText({fixedPitch:5});try{await stream.next();await stream.return();}finally{await index.close();}expect(await fs.readdir('/scratch')).toEqual([]);
});
it('preserves native row tolerance ordering for generated mixed positions',async()=>{
 const glyphs=Array.from({length:257},(_,i)=>glyph(String.fromCharCode(65+i%26),(i*71)%200,(i*31)%120));
 const display:PdfDisplayList={pageIndex:0,width:200,height:200,rotation:0,glyphs,paths:[],images:[],operations:[],annotations:[]};
 const fs=createMemoryFileSystem();await fs.mkdir('/scratch');const index=await PdfRawTextIndex.create(glyphs,{fs,directory:'/scratch'},{mode:'layout'});
 try{for(const fixedPitch of [undefined,5]){let result='';for await(const part of index.layoutText({fixedPitch}))result+=part;expect(result).toBe(formatExtractedPageText(extractPageFromDisplayList(display,{mode:'layout'}),{mode:'layout',fixedPitch}));}}finally{await index.close();}expect(await fs.readdir('/scratch')).toEqual([]);
});
