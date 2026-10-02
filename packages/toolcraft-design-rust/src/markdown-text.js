import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {displayWidth,graphemes} from "./terminal.js";
import {stripAnsi} from "./ansi.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke=createComponentPolicy(native.designMarkdownTextPolicy,{
  gt:(a,b)=>a>b,ge:(a,b)=>a>=b,lt:(a,b)=>a<b,le:(a,b)=>a<=b,same:(a,b)=>a===b,
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,undefined:()=>undefined,
  visibleWidth:value=>displayWidth(stripAnsi(value)),oneValue:value=>[value],
  wrapState:()=>({lines:[],currentLine:"",currentWidth:0,pendingSpace:""}),
  splitState:()=>({chunks:[],chunk:"",chunkWidth:0}),
  walkTokens:(tokens,width,state)=>{for(const token of tokens)invoke("token",[token,width,state]);},
  walkChunks:(chunks,token,width,state)=>{for(let index=0;index<chunks.length;index++)invoke("chunk",[chunks,index,token,width,state]);},
  at:(values,index)=>values[index],optionalType:(values,index)=>values[index]?.type,
  flushLine:state=>{state.lines.push(state.currentLine);state.currentLine="";state.currentWidth=0;state.pendingSpace="";},
  pendingSpace:(state,token)=>{state.pendingSpace+=token.value;},
  appendGap:(state,gap,width)=>{state.currentLine+=gap;state.currentWidth+=width;},
  appendFormatted:(state,chunk,token)=>{state.currentLine+=token.formatters.reduce((text,formatter)=>formatter(text),chunk);},
  chunkDone:(state,width)=>{state.currentWidth+=width;state.pendingSpace="";},
  finishLine:state=>state.lines.push(state.currentLine),
  walkGraphemes:(value,width,state)=>{for(const grapheme of graphemes(value))invoke("grapheme",[grapheme,width,state]);},
  flushChunk:state=>{state.chunks.push(state.chunk);state.chunk="";state.chunkWidth=0;},
  appendGrapheme:(state,grapheme,width)=>{state.chunk+=grapheme;state.chunkWidth+=width;},
  finishWord:state=>state.chunks.push(state.chunk),
  slice:(value,end)=>value.slice(0,end),
  tokenize:value=>tokenizeText(value,[]),width:value=>Math.max(1,value),
  htmlState:()=>({inTag:false,output:""}),
  walkHtml:(value,state)=>{for(const char of value)invoke("htmlChar",[char,state]);},
  enterTag:state=>{state.inTag=true;},leaveTag:state=>{state.inTag=false;},appendHtml:(state,char)=>{state.output+=char;},
  invalidOperation(){throw new TypeError("Invalid Markdown text operation");}
});

// Internal renderer prerequisites. Primitive text segmentation stays in Rust.
export function tokenizeText(value,formatters) {
  return native.designMarkdownTextTokens(value).map(token=>token.kind==="break"?{type:"break"}:token.kind==="space"?{type:"space",value:value.slice(token.start,token.end)}:{type:"word",value:value.slice(token.start,token.end),formatters});
}
export function wrapTokens(tokens,width) {return invoke("wrap",[tokens,width]);}
export function splitWord(value,width) {return invoke("split",[value,width]);}
export function wrapText(value,width) {return invoke("text",[value,width]);}
export function trimTrailingSpaces(tokens) {return invoke("trim",[tokens]);}
export function stripHtmlTags(value) {return invoke("html",[value]);}
