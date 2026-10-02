import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {plainTerminalText} from "./terminal.js";
import {fitToWidth} from "./explorer-text.js";
import {limitOutputPreview} from "./index.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke=createComponentPolicy(native.designEventGroupsPolicy,{
  integer:value=>!!Number.isInteger(value),lt:(a,b)=>a<b,gt:(a,b)=>a>b,ge:(a,b)=>a>=b,truthy:value=>!!value,
  undefined:()=>undefined,true:()=>true,false:()=>false,array:()=>[],
  invalidCapacity(){throw new RangeError("positive capacities required");},
  mapGet:(groups,id)=>groups.get(id),group:()=>({events:new Map(),expanded:false}),set:(groups,id,group)=>groups.set(id,group),
  publish:(group,event)=>group.events.set(event.id,{...event,text:limitOutputPreview(event.text)}),
  evictChild:group=>group.events.delete(group.events.keys().next().value),evict:groups=>groups.delete(groups.keys().next().value),
  expand:group=>{group.expanded=true;},toggle:group=>{group.expanded=!group.expanded;},
  visitGroups(groups,offset,height){
    const state={result:[],index:0};
    for(const [id,group] of groups)if(!invoke("visitGroup",[state,id,group,offset,height]))break;
    return invoke("finishRows",[state.result,height]);
  },
  index:state=>state.index++,length:state=>state.result.length,
  header:(state,id,group)=>state.result.push({id,text:id,groupId:id,header:true,expanded:group.expanded}),
  visitChildren(state,id,group,offset,height){for(const event of group.events.values())if(!invoke("visitChild",[state,id,event,offset,height]))break;},
  child:(state,id,event)=>state.result.push({...event,groupId:id}),
  plain:plainTerminalText,fit:fitToWidth,text:(marker,text)=>`${marker} ${text}`,
  invalidOperation(){throw new TypeError("Invalid event group operation");}
});
export function createEventGroups({capacity,children}) {
  invoke("validate",[capacity,children]);
  const groups=new Map();
  return {
    append(groupId,event){return invoke("append",[groups,capacity,children,groupId,event]);},
    toggle(groupId){return invoke("toggle",[groups,groupId]);},
    rows(offset,height){return invoke("rows",[groups,offset,height]);}
  };
}
export function renderEventGroupRows(rows,width){return rows.map(row=>invoke("render",[row,width]));}
