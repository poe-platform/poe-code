import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {ScreenBuffer,cellToAnsi} from "./dashboard-buffer.js";
import {computeDashboardLayout} from "./dashboard-layout.js";
import {renderBorder} from "./dashboard-border.js";
import {renderOutputPane} from "./dashboard-output.js";
import {renderStatsPane,renderCompactStatsPane} from "./dashboard-stats.js";
import {renderFooter,defaultHints} from "./dashboard-footer.js";

const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const policy=createComponentPolicy(native.designDashboardSnapshotPolicy,{
  object:()=>({}),array:()=>[],true:()=>true,
  nullish:value=>value==null,truthy:value=>!!value,lt:(a,b)=>a<b,add:(a,b)=>a+b,
  set:(value,key,item)=>{value[key]=item;},push:(items,item)=>items.push(item),
  join:(items,separator)=>items.join(separator),now:()=>Date.now(),
  invoke:(method,receiver,...args)=>Reflect.apply(method,receiver,args),
  layout:computeDashboardLayout,buffer:(width,height)=>new ScreenBuffer(width,height),
  border:renderBorder,output:renderOutputPane,stats:renderStatsPane,compactStats:renderCompactStatsPane,
  footer:renderFooter,hints:defaultHints,cellToAnsi,
  invalidOperation(){throw new TypeError("Invalid dashboard snapshot operation");}
});

export function renderDashboardSnapshot(opts={}) {return policy("render",[opts]);}
