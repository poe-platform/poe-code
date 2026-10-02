import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {graphemes} from "./graphemes.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
export const invokeTextCells=createComponentPolicy(native.designTextCellsPolicy,{
  point:segment=>segment.codePointAt(0),
  flagPoints:segment=>[...segment].map(character=>character.codePointAt(0)),
  flagEvery:points=>!!points.every(point=>invokeTextCells("regional",[point])),
  variation:segment=>!!segment.includes("\ufe0f"),containsTab:value=>!!value.includes("\t"),
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,remainder:(a,b)=>a%b,
  ge:(a,b)=>a>=b,le:(a,b)=>a<=b,gt:(a,b)=>a>b,lt:(a,b)=>a<b,same:(a,b)=>a===b,
  true:()=>true,false:()=>false,empty:()=>"",ellipsisText:()=>"…",ellipsis:prefix=>`${prefix}…`,
  measure(value,start){let column=start;for(const segment of graphemes(value))column=invokeTextCells("displayStep",[column,segment]);return column;},
  expandSegments(value,start){const state={column:start,output:""};for(const segment of graphemes(value))invokeTextCells("expandStep",[state,segment]);return state.output;},
  truncateSegments(value,target){const state={used:0,output:""};for(const segment of graphemes(value))if(!invokeTextCells("truncateStep",[state,segment,target]))break;return state.output;},
  takeSegments(value,width,start){const state={used:0,column:start,output:""};for(const segment of graphemes(value))if(!invokeTextCells("takeStep",[state,segment,width]))break;return state.output;},
  splitSegments(value,start){const state={column:start,offset:0,cells:[]};for(const segment of graphemes(value))invokeTextCells("splitStep",[state,segment]);return state.cells;},
  append:(state,value)=>{state.output+=value;},appendSpaces:(state,count)=>{state.output+=" ".repeat(count);},
  advanceColumn:(state,width)=>{state.column+=width;},setColumn:(state,column)=>{state.column=column;},advanceUsed:(state,width)=>{state.used+=width;},
  truncateTarget:width=>Math.max(0,width-1),spaces:count=>" ".repeat(count),
  centerPadding:(width,used)=>Math.max(0,Math.floor((width-used)/2)),center:(padding,fitted)=>`${" ".repeat(padding)}${fitted}`,
  pushCell:(state,segment,width)=>state.cells.push({value:segment,start:state.offset,end:state.offset+segment.length,width}),
  advanceOffset:(state,segment)=>{state.offset+=segment.length;},
  invalidOperation(){throw new TypeError("Invalid text cell operation");}
});
