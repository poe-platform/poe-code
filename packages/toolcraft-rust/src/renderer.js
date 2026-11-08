import {createRequire} from "node:module";
import {renderDetailCard} from "toolcraft-design-rust";
import {yamlFormat} from "@poe-code/config-mutations-rust/yaml";
import {isMCPResult} from "./mcp-result.js";
import {callNative,protect} from "./host-errors.js";

const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){
  if(depth>=128)throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try{return callNative(native.rendererPolicy,operation,args,host);}
  finally{depth--;}
}
function isObject(value){return value!==null&&typeof value==="object"&&!Array.isArray(value);}
function isMcpTextContent(value){return invoke("mcpText",[value]);}
function stringifyJson(value,spaces){
  try{return JSON.stringify(value,(_key,currentValue)=>invoke("jsonValue",[currentValue]),spaces)??String(value);}
  catch{return String(value);}
}
const operations={
  true:()=>true,false:()=>false,undefined:()=>undefined,zeroValue:()=>0,
  truthy:value=>!!value,strictTrue:value=>value===true,
  isObject,isMcp:isMCPResult,isArray:value=>Array.isArray(value),
  isString:value=>typeof value==="string",isBoolean:value=>typeof value==="boolean",isBigint:value=>typeof value==="bigint",
  nonempty:value=>value.length>0,zero:value=>value===0,one:value=>value===1,moreThanOne:value=>value>1,
  list:(...values)=>values,row:(label,value)=>({label,value}),section:(title,rows)=>({title,rows}),
  status:mcpError=>({mcpError}),envelope:(result,mcpError)=>({result,mcpError}),
  ok:()=>({ok:true}),result:result=>({result}),
  keys:value=>Object.keys(value),property:(value,key)=>value[key],
  hasOwn:(value,key)=>Object.prototype.hasOwnProperty.call(value,key),
  toString:value=>value.toString(),join:(value,separator)=>value.join(separator),
  json:value=>stringifyJson(value),jsonPretty:value=>stringifyJson(value,2),yaml:value=>yamlFormat.serialize(value),
  customJson:(command,result,primitives)=>command.render.json(result,primitives),
  customMarkdown:(command,result,primitives)=>command.render.markdown(result,primitives),
  customRich:(command,result,primitives)=>command.render.rich(result,primitives),
  write:(write,payload)=>write(`${payload}\n`),writeError:(write,payload)=>write(`${payload}\n`,"stderr"),
  mcpText:envelope=>envelope.content.filter(isMcpTextContent).map(block=>block.text).join("\n"),
  stringArray:result=>result.every(value=>typeof value==="string"),
  objectArray:value=>value.every(entry=>isObject(entry)),
  scalarArray:value=>value.every(entry=>invoke("scalarField",[entry])),
  scalarList:(value,separator)=>value.map(entry=>invoke("scalar",[entry])).join(separator),
  humanState:()=>({output:"",capitalizeNext:true}),
  eachCharacter(key,state){for(const char of key)invoke("character",[char,state]);},
  humanAppend:(state,text)=>{state.output+=text;},humanUncapitalize:state=>{state.capitalizeNext=false;},
  asciiUpper:char=>char>="A"&&char<="Z",endsSpace:value=>value.endsWith(" "),upper:value=>value.toUpperCase(),
  map:()=>new Map(),get:(map,key)=>map.get(key),set:(map,key,value)=>map.set(key,value),
  incrementCount:(counts,label)=>(counts.get(label)??0)+1,
  eachKey(result,labels,counts){for(const key of Object.keys(result))invoke("label",[key,labels,counts]);},
  eachLabel(labels,counts){for(const [key,label] of labels)invoke("collision",[key,label,labels,counts]);},
  detailEntries(result,depth,labels,rows){
    for(const [key,value] of Object.entries(result)){
      const label=`${"  ".repeat(depth)}${labels.get(key)}`;
      invoke("detail",[value,label,depth,rows]);
    }
  },
  increment:value=>value+1,push:(rows,row)=>rows.push(row),extend:(rows,items)=>rows.push(...items),
  prepend:(row,rows)=>[row,...rows],indexLabel:(depth,index)=>`${"  ".repeat(depth)}${index+1}`,
  arrayDetails:(value,depth)=>value.flatMap((entry,index)=>invoke("arrayDetail",[value,entry,index,depth])),
  scalarRows:(result,labels)=>Object.entries(result).filter(([,value])=>invoke("scalarField",[value]))
    .map(([key,value])=>({label:labels.get(key),value:invoke("scalar",[value])})),
  objectSections:(result,labels)=>Object.entries(result).filter(([,value])=>isObject(value))
    .map(([key,value])=>({title:labels.get(key),rows:invoke("rows",[value,0])})).filter(section=>section.rows.length>0),
  objectArraySections:(result,labels)=>Object.entries(result).flatMap(([key,value])=>invoke("arraySections",[value,labels,key])),
  arraySections:(value,title)=>value.map((entry,index)=>invoke("arraySection",[value,title,entry,index])).filter(section=>section.rows.length>0),
  indexTitle:(title,index)=>`${title} ${index+1}`,
  listRows:(result,labels)=>Object.entries(result).filter(([,value])=>invoke("listField",[value]))
    .map(([key,value])=>({label:labels.get(key),value:invoke("stacked",[value])})),
  card:(primitives,title,scalarRows,nestedSections,listRows,arrayObjectSections)=>renderDetailCard({
    theme:primitives.getTheme(),title,sections:[{rows:scalarRows},...nestedSections,{title:"Lists",rows:listRows},...arrayObjectSections]
  }),
  description:command=>command.description?.trim(),hasNewline:value=>value.includes("\n"),shortTitle:value=>value.length<=64,
  objectTable:(primitives,rows)=>primitives.renderTable({theme:primitives.getTheme(),variant:"detail",columns:[
    {name:"label",title:"Label",alignment:"left",maxLen:Math.max("Label".length,...rows.map(row=>row.label.length))},
    {name:"value",title:"Value",alignment:"left",maxLen:Math.max("Value".length,...rows.map(row=>row.value.length))}
  ],rows}),
  setObject:()=>new Set(),spread:names=>[...names],
  columnNames(rows,names){for(const row of rows)for(const name of Object.keys(row))names.add(name);},
  arrayTable:(primitives,result,columnNames)=>primitives.renderTable({theme:primitives.getTheme(),
    columns:columnNames.map(name=>({name,title:name,alignment:"left",maxLen:Math.max(name.length,...result.map(row=>invoke("cellLength",[row,name])))})),
    rows:result.map(row=>Object.fromEntries(columnNames.map(name=>[name,invoke("cell",[row,name])])))}),
  objectMarkdown:result=>Object.entries(result).map(([key,value])=>`- ${key}: ${invoke("stringify",[value])}`).join("\n"),
  escapePipe:value=>value.replaceAll("|","\\|"),
  arrayMarkdown(result,columnNames){
    const header=`| ${columnNames.join(" | ")} |`;
    const separator=`| ${columnNames.map(()=>":---").join(" | ")} |`;
    const rows=result.map(row=>`| ${columnNames.map(name=>invoke("markdownCell",[row,name])).join(" | ")} |`);
    return [header,separator,...rows].join("\n");
  },
  invalidOperation(){throw new TypeError("Invalid result renderer operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};

export function renderObjectTable(result,primitives){return invoke("objectTable",[result,primitives]);}
export function renderArrayTable(result,primitives){return invoke("arrayTable",[result,primitives]);}
export function renderResult(command,result,output,primitives,write=(chunk,stream="stdout")=>{
  if(stream==="stderr"){process.stderr.write(chunk);return;}
  process.stdout.write(chunk);
}){return invoke("render",[command,result,output,primitives,write]);}
