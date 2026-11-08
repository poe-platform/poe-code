import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {typography} from "./text.js";
import {stripAnsi} from "./ansi.js";
import {stripHtmlTags,tokenizeText,trimTrailingSpaces,wrapTokens} from "./markdown-text.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke=createComponentPolicy(native.designMarkdownInlinePolicy,{
  same:(a,b)=>a===b,gt:(a,b)=>a>b,truthy:value=>!!value,isNull:value=>value===null,
  undefined:()=>undefined,null:()=>null,array:()=>[],hasChildren:node=>"children" in node,
  collect:(nodes,formatters,ctx,tokens)=>{for(const node of nodes)invoke("collect",[node,formatters,ctx,tokens]);},
  pushText:(tokens,node,formatters)=>tokens.push(...tokenizeText(stripAnsi(node.value),formatters)),
  collectStyled(node,formatters,ctx,tokens,style){const children=node.children,extended=[...formatters,typography[style]];for(const child of children)invoke("collect",[child,extended,ctx,tokens]);},
  pushCode:(tokens,node,formatters,ctx)=>tokens.push(...tokenizeText(stripAnsi(node.value),[...formatters,ctx.theme.accent])),
  pushImage:(tokens,node,formatters,ctx)=>tokens.push({type:"word",value:invoke("placeholder",[stripAnsi(node.alt)]),formatters:[...formatters,ctx.theme.muted]}),
  placeholder:alt=>`[image: ${alt}]`,
  pushFootnote:(tokens,number,formatters)=>tokens.push({type:"word",value:`[${number}]`,formatters:[...formatters,typography.dim]}),
  htmlValue:node=>stripAnsi(stripHtmlTags(node.value)),
  pushValue:(tokens,value,formatters)=>tokens.push(...tokenizeText(value,formatters)),
  pushBreak:tokens=>tokens.push({type:"break"}),
  firstType:node=>node.children[0]?.type,label:node=>node.children[0].value,
  starts:(node,prefix)=>!!node.url.startsWith(prefix),urlSuffix:(node,start)=>node.url.slice(start),
  pushAutolink:(tokens,node,formatters,ctx)=>tokens.push({type:"word",value:stripAnsi(node.url),formatters:[...formatters,ctx.theme.accent]}),
  trim:trimTrailingSpaces,pushTokens:(tokens,children)=>tokens.push(...children),
  someWords:tokens=>!!tokens.some(token=>token.type==="word"),pushSpace:tokens=>tokens.push({type:"space",value:" "}),
  pushLink:(tokens,node,formatters,ctx)=>tokens.push({type:"word",value:`(${stripAnsi(node.url)})`,formatters:[...formatters,ctx.theme.accent]}),
  has:(footnotes,label)=>!!footnotes.definitions.has(label),get:(footnotes,label)=>footnotes.numbers.get(label),
  next:footnotes=>footnotes.numbers.size+1,
  set:(footnotes,label,number)=>footnotes.numbers.set(label,number),labelAdded:(footnotes,label)=>footnotes.labelsInOrder.push(label),
  invalidOperation(){throw new TypeError("Invalid Markdown inline operation");}
});
export function tokenizeInline(nodes,context) {
  const tokens=[];
  for(const node of nodes)invoke("collect",[node,[],context,tokens]);
  return tokens;
}
export function renderInline(nodes,context) {
  const tokens=tokenizeInline(nodes,context);
  return wrapTokens(tokens,context.width);
}
export function resolveFootnoteNumber(label,context) {return invoke("footnote",[label,context]);}
