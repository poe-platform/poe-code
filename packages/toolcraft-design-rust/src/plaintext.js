import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {stripAnsi} from "./ansi.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke=createComponentPolicy(native.designPlaintextPolicy,{
  truthy:value=>!!value,isFalse:value=>value===false,add:(a,b)=>a+b,same:(a,b)=>a===b,le:(a,b)=>a<=b,lt:(a,b)=>a<b,gt:(a,b)=>a>b,subtract:(a,b)=>a-b,
  undefined:()=>undefined,array:()=>[],strip:stripAnsi,
  children:(nodes,ctx)=>nodes.map(node=>invoke("inline",[node,ctx])).join(""),
  blocks:(nodes,ctx)=>nodes.map(node=>invoke("blockChild",[node,ctx])).join(""),
  trim:value=>value.trim(),at:(value,index)=>value[index],slice:(value,start,end)=>value.slice(start,end),
  paragraph:text=>`${text}\n\n`,prefixed:(prefix,text)=>`${prefix}${text}\n\n`,
  expandLink:(text,node)=>`${text} ${stripAnsi(node.url)}`,showLink:text=>`${text} (link)`,
  hasReference:(ctx,node)=>!!ctx.footnoteOrder.includes(node.label),addReference:(ctx,node)=>ctx.footnoteOrder.push(node.label),reference:(ctx,node)=>`[${ctx.footnoteOrder.indexOf(node.label)+1}]`,
  collect:(nodes,ctx)=>{for(const node of nodes)invoke("collectNode",[node,ctx]);},hasChildren:node=>"children" in node,
  definition:(node,ctx)=>ctx.footnoteDefinitions.set(node.label,invoke("blocks",[node.children,{announceHeadings:ctx.announceHeadings,announceCode:ctx.announceCode,announceAlerts:ctx.announceAlerts,showLinks:ctx.showLinks,expandLinks:ctx.expandLinks,includeFrontmatter:ctx.includeFrontmatter,footnoteDefinitions:new Map(),footnoteOrder:[]}]).trim()),
  notes:ctx=>ctx.footnoteOrder.map((label,index)=>invoke("note",[ctx,label,index])).filter(value=>value.length>0).join(" "),
  definitionText:(ctx,label)=>ctx.footnoteDefinitions.get(label),note:(index,text)=>`Note ${index+1}: ${text}.`,
  withNotes:(text,notes)=>`${text}\n\n${notes}`,alertPrefix:node=>`${node.kind}: `,
  listItems:(node,ctx)=>node.children.filter(child=>invoke("isListItem",[child])).map((child,index)=>invoke("listItem",[child,index,node,ctx])),
  listText:(prefix,text)=>`${prefix}${text}`,listJoin:(items,node)=>`${items.join(invoke("listSeparator",[node,items]))}\n\n`,
  checkedText:(prefix,text)=>`${prefix}${text}`,
  tableParts(node){const [header,...body]=node.children.filter(child=>invoke("isTableRow",[child]));return {header,body};},
  headers:(header,ctx)=>header.children.map(cell=>invoke("tableHeader",[cell,ctx])),
  sentences:(rows,headers,ctx)=>rows.flatMap(row=>row.children.flatMap((cell,index)=>invoke("tableCell",[cell,index,headers,ctx]))),
  header:(headers,index)=>headers[index]?.trim()??"",sentence:(header,value)=>`${header} is ${value}.`,tableText:sentences=>`${sentences.join(" ")}\n\n`,
  code:(prefix,node)=>`${prefix}${node.value}`,
  frontmatter:node=>`${Object.entries(node.data).map(([key,value])=>`${key}: ${String(value)}.`).join(" ")}\n\n`,
  invalidOperation(){throw new TypeError("Invalid plaintext operation");}
});
export function renderPlaintext(ast,options) {
  return invoke("block",[ast,{announceHeadings:options?.announceHeadings??true,announceCode:options?.announceCode??true,announceAlerts:options?.announceAlerts??true,showLinks:options?.showLinks??false,expandLinks:options?.expandLinks??false,includeFrontmatter:options?.includeFrontmatter??false,footnoteDefinitions:new Map(),footnoteOrder:[]}]);
}
import {parse} from "./markdown-parser.js";

export function renderMarkdownPlaintext(markdown,options) {
  const {ast}=parse(markdown);
  return renderPlaintext(ast,options);
}
