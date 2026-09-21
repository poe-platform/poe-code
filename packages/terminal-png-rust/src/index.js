import {randomUUID} from 'node:crypto';
import {rename,rm,writeFile} from 'node:fs/promises';
import {native,encoded} from './native.js';
import {parseAnsi} from './ansi-parser.js';
import {renderSvg} from './svg-renderer.js';
import {renderPng} from './png-renderer.js';
export async function renderTerminalPng(ansiText,options={}){
 native.validateTerminalRenderOptions(encoded({padding:options.padding,output:options.output}));
 const png=renderPng(renderSvg(parseAnsi(ansiText),{padding:options.padding,window:options.window}));
 if(options.output!==undefined){const publication=new native.NativeTerminalPublication(options.output,randomUUID());try{await writeFile(publication.temporaryPath,png,{flag:'wx'});publication.written();await rename(publication.temporaryPath,options.output);}catch(error){const ownCode=typeof error==='object'&&error!==null&&Object.hasOwn(error,'code'),code=ownCode?error.code:undefined;if(publication.cleanup(error instanceof Error,ownCode,typeof code==='string'?code:undefined)){try{await rm(publication.temporaryPath,{force:true});}catch{}}throw error;}}
 return png;
}
export * from './ansi-parser.js';
export * from './svg-renderer.js';
export * from './png-renderer.js';
export * from './font.js';
