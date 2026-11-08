import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {ScreenBuffer,cellToAnsi} from "./dashboard-buffer.js";
import {filterRows} from "./explorer-filter.js";
import {computeExplorerLayout} from "./explorer-layout.js";
import {createInitialState,REGION_ALL} from "./explorer-state.js";
import {renderExplorer} from "./explorer-render.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const policy=createComponentPolicy(native.designExplorerFixturesPolicy,{
  undefined:()=>undefined,null:()=>null,true:()=>true,false:()=>false,nullish:value=>value==null,
  data:kind=>native.designExplorerFixtureData(kind),object:()=>({}),array:(...items)=>items,
  define:(object,key,value)=>{Object.defineProperty(object,key,{value,enumerable:true,writable:true,configurable:true});},
  set:(object,key,value)=>{object[key]=value;},at:(object,key)=>object[key],lt:(a,b)=>a<b,
  rowLoader:rows=>({rows:async()=>rows}).rows,emptyItems:()=>({items:async()=>[]}).items,
  singleRender:()=>({render:()=>policy("singleRender",[])}).render,
  listRender:index=>({render:()=>policy("listRender",[index])}).render,
  handler:()=>({handler:()=>undefined}).handler,
  initialState:(config,size)=>createInitialState(config,size),filterRows:(filter,rows)=>filterRows(filter,rows),
  indices:matches=>matches.map(match=>match.index),positions:matches=>new Map(matches.map(match=>[match.index,match.positions])),
  selected:()=>new Set(["27","24"]),allRegions:()=>REGION_ALL,layout:size=>computeExplorerLayout(size),
  overrides(state,overrides){for(const [key,value] of Object.entries(overrides))state[key]=value;},
  screen:(cols,rows)=>new ScreenBuffer(cols,rows),render:(state,screen)=>renderExplorer(state,screen),
  cell:(screen,x,y)=>screen.get(x,y),ansi:cell=>cellToAnsi(cell),concat:(a,b)=>a+b,
  push:(lines,line)=>lines.push(line),join:lines=>lines.join("\n"),split:value=>value.split("\n"),trimLines:lines=>lines.map(line=>line.trimEnd()),
  invalidOperation(){throw new TypeError("Invalid explorer fixture operation");}
});
export function renderStateSnapshot(state){return policy("snapshot",[state]);}
export function dumpScreen(screen){return policy("dump",[screen]);}
export function fixtureState(overrides={}){return policy("state",[overrides]);}
export function fixtureRows(){return native.designExplorerFixtureData("rows");}
export function singleDetailItem(){return policy("single",[]);}
export function listDetailItems(){return policy("list",[]);}
