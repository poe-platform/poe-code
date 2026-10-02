import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {graphemes,graphemeWidth} from "./terminal.js";
import {foreground,background,styleToSgrDelta} from "./screen-style.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const EMPTY={ch:" ",width:1,style:0,fg:0,bg:0};
const policy=createComponentPolicy(native.designScreenPolicy,{
  undefined:()=>undefined,true:()=>true,false:()=>false,empty:()=>"",space:()=>" ",
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,multiply:(a,b)=>a*b,remainder:(a,b)=>a%b,
  ge:(a,b)=>a>=b,gt:(a,b)=>a>b,lt:(a,b)=>a<b,le:(a,b)=>a<=b,same:(a,b)=>a===b,
  max:(a,b)=>Math.max(a,b),min:(a,b)=>Math.min(a,b),row:(index,cols)=>Math.floor(index/cols),
  or:(a,b)=>a|b,shift:(a,b)=>a<<b,number:value=>typeof value==="number",truthy:value=>!!value,
  normalize:value=>Number.isFinite(value)?Math.max(0,Math.floor(value)):0,
  invoke:(method,receiver,...args)=>Reflect.apply(method,receiver,args),
  setCols:(screen,value)=>{screen.cols=value;},setRows:(screen,value)=>{screen.rows=value;},
  setFront:(screen,value)=>{screen.front=value;},setBack:(screen,value)=>{screen.back=value;},
  setOutputStyle:(screen,value)=>{screen.outputStyle=value;},
  cells:length=>Array.from({length},()=>({...EMPTY})),
  makeCell:(ch,width,style)=>({ch,width,style,fg:foreground(style),bg:background(style)}),
  firstGrapheme:ch=>graphemes(ch)[0],graphemeWidth,
  at:(array,index)=>array[index],setAt:(array,index,value)=>{array[index]=value;},
  colorIndex:value=>["","red","green","yellow","blue","magenta","cyan","white","gray"].indexOf(value),
  hexColor:value=>value.startsWith("#"),
  set:()=>new Set(),setAdd:(set,index)=>set.add(index),ordered:set=>[...set].sort((a,b)=>a-b),
  delta:styleToSgrDelta,cursor:(row,col)=>`\u001b[${row};${col}H`,
  invalidOperation:()=>{throw new TypeError("Invalid screen operation");}
});

export class Screen {
  cols=0;
  rows=0;
  front=[];
  back=[];
  outputStyle=0;
  colors;
  constructor(size={cols:0,rows:0},options={}) {
    this.colors=options.colors??(process.env.NO_COLOR===undefined&&process.env.TERM!=="dumb");
    this.resize(size);
  }
  get width(){return this.cols;}
  get height(){return this.rows;}
  resize(size){policy("resize",[this,size]);}
  cell(x,y,ch,style=0){policy("cell",[this,x,y,ch,style]);}
  text(x,y,text,style=0){
    let offset=0;
    for(const segment of graphemes(text))offset=policy("textStep",[this,x,y,segment,style,offset]);
  }
  put(x,y,text,style=0){policy("put",[this,x,y,text,style]);}
  clearRect(rect,style=0){policy("clearRect",[this,rect,style]);}
  flush(){return policy("flush",[this]);}
  index(x,y){return policy("index",[this,x,y]);}
  inBounds(x,y){return policy("inBounds",[this,x,y]);}
}
