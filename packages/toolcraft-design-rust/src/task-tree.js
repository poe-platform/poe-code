import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {plainTerminalText} from "./terminal.js";
import {fitToWidth} from "./explorer-text.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke=createComponentPolicy(native.designTaskTreePolicy,{
  integer:value=>!!Number.isInteger(value),lt:(a,b)=>a<b,ge:(a,b)=>a>=b,truthy:value=>!!value,
  undefined:()=>undefined,array:()=>[],set:()=>new Set(),
  invalidCapacity(){throw new RangeError("positive capacity required");},
  capacityExceeded(){throw new RangeError("Task capacity exceeded");},cycle(){throw new Error("Task cycle");},
  hasNode:(nodes,node)=>!!nodes.has(node.id),seen:node=>new Set([node.id]),
  has:(values,key)=>!!values.has(key),add:(values,key)=>values.add(key),get:(values,key)=>values.get(key),delete:(values,key)=>values.delete(key),
  parent:(nodes,parent)=>nodes.get(parent)?.parentId,
  previous:(nodes,node)=>nodes.get(node.id),unlinkPrevious:(children,previous,node)=>children.get(previous.parentId)?.delete(node.id),
  store:(nodes,node)=>nodes.set(node.id,{...node}),siblings:(children,node)=>children.get(node.parentId),
  setSiblings:(children,node,siblings)=>children.set(node.parentId,siblings),addSibling:(siblings,node)=>siblings.add(node.id),
  unlink:(children,node,id)=>children.get(node.parentId)?.delete(id),pending:id=>[id],pop:values=>values.pop(),
  queueChildren:(children,current,pending)=>{for(const child of children.get(current)??[])pending.push(child);},
  stack:children=>[{iterator:(children.get(undefined)??new Set()).values(),depth:0}],
  frame:stack=>stack[stack.length-1],next:frame=>frame.iterator.next(),nextNode:(nodes,next)=>nodes.get(next.value),
  row:(result,node,frame,collapsed)=>result.push({...node,depth:frame.depth,collapsed:collapsed.has(node.id)}),
  collapsed:(collapsed,node)=>!!collapsed.has(node.id),hasChildren:(children,node)=>!!children.has(node.id),
  descend:(stack,children,node,frame)=>stack.push({iterator:children.get(node.id).values(),depth:frame.depth+1}),
  markers:(pending,running,success,error)=>({pending,running,success,error}),
  renderRows:(rows,width,markers)=>rows.map(row=>invoke("render",[row,width,markers])),
  indent:(row,width)=>" ".repeat(Math.min(Math.max(0,width),Math.max(0,row.depth)*2)),
  finiteDuration:row=>!!Number.isFinite(row.durationMs),duration:row=>` · ${Math.max(0,Math.round(row.durationMs))}ms`,
  coerce:value=>`${value}`,marker:(markers,row)=>markers[row.status],plain:plainTerminalText,fit:fitToWidth,
  text:(indent,arrow,marker,label,duration)=>`${indent}${arrow} ${marker} ${label}${duration}`,
  invalidOperation(){throw new TypeError("Invalid task tree operation");}
});
export function createTaskTree({capacity=10000}={}) {
  invoke("validate",[capacity]);
  const nodes=new Map(),children=new Map(),collapsed=new Set();
  return {
    upsert(node){return invoke("upsert",[nodes,children,capacity,node]);},
    remove(id){return invoke("remove",[nodes,children,collapsed,id]);},
    toggle(id){return invoke("toggle",[collapsed,id]);},
    rows(offset,height){return invoke("rows",[nodes,children,collapsed,offset,height]);}
  };
}
export function renderTaskRows(rows,width){return invoke("renderRows",[rows,width]);}
