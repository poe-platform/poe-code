import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {highlightCodeBlock} from "./code-highlight.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const escapeHtml=value=>{let output="";for(const char of value)output+=invoke("escape",[char]);return output;};
const invoke=createComponentPolicy(native.designHtmlPolicy,{
  truthy:value=>!!value,isFalse:value=>value===false,isNull:value=>value===null,type:value=>typeof value,
  same:(a,b)=>a===b,gt:(a,b)=>a>b,lt:(a,b)=>a<b,ge:(a,b)=>a>=b,le:(a,b)=>a<=b,
  undefined:()=>undefined,null:()=>null,at:(value,index)=>value[index],string:value=>String(value),
  add:(a,b)=>a+b,trim:value=>value.trim(),startsWith:(value,prefix)=>value.startsWith(prefix),lower:value=>value.toLowerCase(),code:char=>char.charCodeAt(0),
  hasChildren:node=>"children" in node,escape:escapeHtml,
  wrap:(tag,content)=>`<${tag}>${content}</${tag}>`,attribute:(key,value)=>` ${key}="${value}"`,
  heading:(node,content)=>`<h${node.depth}>${content}</h${node.depth}>`,
  alert:(kind,content)=>`<blockquote data-alert="${kind}">${content}</blockquote>`,
  rootBlocks:(nodes,ctx)=>nodes.filter(node=>invoke("notDefinition",[node])).map(node=>invoke("node",[node,ctx])).filter(value=>value.length>0),
  append:(values,value)=>values.push(value),join:(values,separator)=>values.join(separator),
  children:(nodes,ctx)=>nodes.map(node=>invoke("node",[node,ctx])).filter(value=>value.length>0).join("\n"),
  inlineChildren:(nodes,ctx)=>nodes.map(node=>invoke("inline",[node,ctx])).join(""),
  highlight:highlightCodeBlock,language:value=>` class="language-${value}"`,
  tokens:tokens=>tokens.map(token=>invoke("token",[token])).join(""),
  token:(kind,token)=>`<span class="tc-token-${kind}">${escapeHtml(token.value)}</span>`,
  codeBlock:(attribute,content)=>`<pre><code${attribute}>${content}</code></pre>`,
  listItems:(nodes,ctx)=>nodes.map(node=>invoke("listChild",[node,ctx])).filter(value=>value.length>0).join(""),
  list:(tag,attribute,items)=>`<${tag}${attribute}>${items}</${tag}>`,
  itemChildren:(nodes,ctx)=>nodes.map((node,index)=>invoke("itemChild",[node,index,ctx])).filter(value=>value.length>0),
  item:(checkbox,children)=>`<li>${checkbox}${children.join("")}</li>`,
  tableRows:nodes=>nodes.filter(node=>invoke("isTableRow",[node])),
  bodyRows:(rows,node,ctx)=>rows.slice(1).map(row=>invoke("tableRow",[row,node.align,"td",ctx])).join(""),
  table:(header,body)=>["<table>",header,body,"</table>"].join("\n"),
  tableCells:(nodes,alignments,tag,ctx)=>nodes.map((node,index)=>invoke("tableCell",[node,index,alignments,tag,ctx])).join(""),
  alignment:value=>` style="text-align: ${value}"`,
  cell:(tag,style,node,ctx)=>`<${tag}${style}>${invoke("inlineChildren",[node.children,ctx])}</${tag}>`,
  frontmatterLines:data=>Object.entries(data).map(([key,value])=>`${key}: ${invoke("frontmatterValue",[value])}`),
  frontmatter:lines=>`<pre><code class="language-yaml">${escapeHtml(lines.join("\n"))}</code></pre>`,
  json(value){const ancestors=[];return JSON.stringify(value,function(_key,nestedValue){return invoke("jsonValue",[nestedValue,this,ancestors]);});},
  last:values=>values[values.length-1],pop:values=>values.pop(),includes:(values,value)=>!!values.includes(value),
  attributes:(href,title)=>[href,title].join(""),imageAttributes:(src,alt,title)=>[src,alt,title].join(""),
  link:(attributes,node,ctx)=>`<a${attributes}>${invoke("inlineChildren",[node.children,ctx])}</a>`,image:attributes=>`<img${attributes}>`,
  createFootnotes(nodes){const definitions=new Map();for(const node of nodes)invoke("collect",[node,definitions]);return {definitions,labelsInOrder:[],numbers:new Map()};},
  collect:(nodes,definitions)=>{for(const node of nodes)invoke("collect",[node,definitions]);},
  definition:(definitions,node)=>definitions.set(node.label,node),
  hasDefinition:(footnotes,node)=>!!footnotes.definitions.has(node.label),
  number:(footnotes,node)=>footnotes.numbers.get(node.label),
  addLabel:(footnotes,node)=>footnotes.labelsInOrder.push(node.label),
  labelCount:footnotes=>footnotes.labelsInOrder.length,
  setNumber:(footnotes,node,number)=>footnotes.numbers.set(node.label,number),
  id:label=>escapeHtml(encodeURIComponent(label)),
  reference:(id,number)=>`<sup id="fnref-${id}"><a href="#fn-${id}">${number}</a></sup>`,
  notes:(footnotes,ctx)=>footnotes.labelsInOrder.map(label=>invoke("note",[label,footnotes,ctx])).filter(value=>value.length>0).join(""),
  getDefinition:(footnotes,label)=>footnotes.definitions.get(label),
  note:(id,content)=>`<li id="fn-${id}">${content} <a href="#fnref-${id}" aria-label="Back to content">Back</a></li>`,
  footnotes:items=>`<section class="footnotes"><ol>${items}</ol></section>`,
  invalidOperation(){throw new TypeError("Invalid HTML operation");}
});

export function renderHtml(ast,options={}) {
  const context={showFrontmatter:options.showFrontmatter??false,allowRawHtml:options.allowRawHtml??false,syntaxHighlight:options.syntaxHighlight??false,footnotes:invoke("footnoteState",[ast])};
  return invoke("node",[ast,context]);
}
