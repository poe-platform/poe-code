import {createRequire} from 'node:module';
import {createComponentPolicy} from './component-host.js';
import {ansiToCells} from './ansi-text.js';
import {renderMarkdown} from './markdown.js';
const native=createRequire(import.meta.url)('./toolcraft-design-rust.node');
const markdownCache=new Map(),charCodeAt=String.prototype.charCodeAt;
const policy=createComponentPolicy(native.designExplorerDetailContentPolicy,{
  object:()=>({}),array:()=>[],undefined:()=>undefined,
  assign:(value,key,item)=>{value[key]=item;},
  trim:content=>content.trim(),trimEnd:text=>text.trimEnd(),same:(a,b)=>a===b,max:Math.max,
  key:(hash,width)=>`${hash}:${width}`,
  hash:content=>typeof content==='string'&&Object.getOwnPropertyDescriptor(String.prototype,'charCodeAt')?.value===charCodeAt?native.designExplorerContentHash(content):policy('hash',[content]),
  lt:(a,b)=>a<b,charCodeAt:(content,index)=>content.charCodeAt(index),xor:(a,b)=>a^b,imul:Math.imul,unsigned:value=>value>>>0,
  cacheGet:(cache,key)=>cache.get(key),cacheSet:(cache,key,value)=>cache.set(key,value),
  render:(content,width)=>renderMarkdown(content,{width}),cells:ansiToCells,
  push:(lines,line)=>lines.push(line),lastPush:(lines,cell)=>lines.at(-1).push(cell),
  walkCells(cells,lines){for(const cell of cells)policy('cell',[cell,lines]);},
  invalidOperation(){throw new TypeError('Invalid explorer detail content operation');}
});
export function prepareDetailContent(content,width){return policy('prepare',[content,width,markdownCache]);}
