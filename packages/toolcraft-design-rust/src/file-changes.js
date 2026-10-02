import { createRequire } from "node:module";
import { color } from "./color.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const kinds = native.designFileChangeKinds();
const markers = Object.fromEntries(kinds);
const labels = Object.fromEntries(kinds.map(([kind]) => [kind, kind]));
const thrown = new WeakMap();
const protect = operation => (...args) => {
  try { return operation(...args); }
  catch (value) { const carrier = new Error("File-change host operation failed"); thrown.set(carrier,value); throw carrier; }
};
let depth=0;
function invoke(operation,args) {
  if(depth>=128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return native.designFileChanges(operation,args,host); }
  catch(error) { if(thrown.has(error)) throw thrown.get(error); throw error; }
  finally { depth--; }
}
const operations = {
  zero: value => value===0, one: value => value===1,
  truthy: value => !!value, positive: value => value>0,
  different: (a,b) => a!==b,
  undefined: () => undefined, array: () => [],
  stringify: value => `${value}`,
  marker: kind => `${markers[kind]}`,
  concat: (a,b) => `${a}${b}`,
  statusLine: (marker,path) => `${marker} ${path}`,
  renamePath: change => `${change.oldPath} -> ${change.path}`,
  conflictColor: marker => color.red.bold(marker),
  color: (style,value) => color[style](value),
  countKind: (counts,change) => counts.set(change.kind,(counts.get(change.kind)??0)+1),
  countConflict: state => { state.conflicts+=1; },
  countGet: (counts,kind) => counts.get(kind)??0,
  detail: (count,kind) => [`${count} ${labels[kind]}`],
  appendConflict: (details,count,noun) => details.push(`${count} ${noun}`),
  summaryLine: (changes,details) => `${changes.length} ${invoke("summaryNoun",[changes.length])} (${details.join(", ")})`,
  status(changes,format) {
    const lines=changes.map(change=>invoke("statusRow",[change,format]));
    return [...lines,"",summary(changes)].join("\n");
  },
  statusMarkdown: output => `\`\`\`text\n${output}\n\`\`\``,
  diff: changes => changes.map(change=>invoke("patch",[change])).join("\n\n"),
  diffMarkdown: output => `\`\`\`diff\n${output}\n\`\`\``,
  diffTerminal: output => output.split("\n").map(line=>invoke("diffColor",[line])).join("\n"),
  oldPath: path => `a/${path}`, newPath: path => `b/${path}`,
  headers: (oldPath,newPath) => [`--- ${oldPath}`,`+++ ${newPath}`],
  patchHunk: (headers,oldContent,newContent) => [...headers,invoke("hunk",[oldContent,newContent])].join("\n"),
  joinLines: lines => lines.join("\n"),
  split: value => value.split("\n"), last: lines => lines.at(-1), pop: lines => lines.pop(),
  equalAt: (oldLines,newLines,index) => oldLines[index]===newLines[index],
  equalTail: (oldLines,newLines,length) => oldLines[oldLines.length-length-1]===newLines[newLines.length-length-1],
  sliceLines: (lines,start,end,prefix) => lines.slice(start,end).map(line=>`${prefix}${line}`),
  hunk: (oldLine,oldCount,newLine,newCount,before,removed,added,after) => [
    `@@ -${oldLine},${oldCount} +${newLine},${newCount} @@`,...before,...removed,...added,...after
  ].join("\n"),
  startsWith: (line,prefix) => line.startsWith(prefix),
  invalidOperation() { throw new TypeError("Invalid file-change operation"); }
};
function summary(changes) {
  const counts=new Map(),state={conflicts:0};
  for(const change of changes) invoke("count",[counts,state,change]);
  const details=Object.keys(labels).flatMap(kind=>invoke("summaryDetail",[counts,kind]));
  return invoke("summaryFinish",[changes,details,state]);
}
const host = {
  get: protect((value,key)=>value[key]),
  operate: protect((name,args)=>operations[name](...args)),
  literal: value=>value, number: value=>value,
  numeric: protect(value=>+value)
};
export function renderFileChanges(changes,options={}) { return invoke("render",[changes,options]); }
