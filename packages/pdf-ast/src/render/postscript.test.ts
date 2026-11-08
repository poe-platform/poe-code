import {expect,it} from 'vitest';
import {createMemoryFileSystem} from '@poe-code/safe-fs';
import {PdfRawTextIndex} from '../extract/raw-text-index.js';
import type {PdfPlacedGlyph} from '../ast.js';
import {encodePostscriptPageChunks} from './postscript.js';
it('streams escaped PostScript lines from caller-backed words',async()=>{
 const fs=createMemoryFileSystem();await fs.mkdir('/scratch');const unicode='a(b)\\c'+'😀'.repeat(8192),glyph:PdfPlacedGlyph={unicode,charCode:65,bbox:[1.6,2.3,5,12],baselineY:2.3,advanceWidth:5,matrix:[1,0,0,1,1.6,2.3],fontSize:10,fontName:'Helvetica',color:{r:0,g:0,b:0}};
 const index=await PdfRawTextIndex.create([glyph],{fs,directory:'/scratch'});
 try{let result='';const decoder=new TextDecoder();for await(const bytes of encodePostscriptPageChunks(index,2)){expect(bytes.length).toBeLessThanOrEqual(8196);result+=decoder.decode(bytes,{stream:true});await Promise.resolve();}result+=decoder.decode();expect(result).toBe('%%Page: 2 2\n/Helvetica findfont 12 scalefont setfont\n2 2 moveto ('+unicode.replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)')+') show\nshowpage\n');}finally{await index.close();}expect(await fs.readdir('/scratch')).toEqual([]);
});
