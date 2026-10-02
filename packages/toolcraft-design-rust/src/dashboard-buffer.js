import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {color} from "./color.js";
import {expandTabs, graphemes, graphemeWidth} from "./terminal.js";
import {parseAnsi} from "./dashboard-ansi.js";

const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const emptyCell = {ch: " ", style: {}};
const policy = createComponentPolicy(native.designDashboardBufferPolicy, {
  undefined: () => undefined, true: () => true, false: () => false,
  object: () => ({}), array: () => [], emptyCell: () => emptyCell, color: () => color,
  add: (a,b) => a+b, multiply: (a,b) => a*b,
  min: (a,b) => Math.min(a,b), max: (a,b) => Math.max(a,b), floor: value => Math.floor(value),
  ge: (a,b) => a>=b, gt: (a,b) => a>b, lt: (a,b) => a<b, le: (a,b) => a<=b, same: (a,b) => a===b,
  truthy: value => !!value, nullish: value => value == null, callable: value => typeof value === "function",
  optionalGet: (value,key) => value?.[key], at: (value,key) => value[key],
  set: (value,key,item) => {value[key]=item;},
  invoke: (method,receiver,...args) => Reflect.apply(method,receiver,args),
  cell: (ch,style) => ({ch,style}), cells: (length,style) => Array.from({length}, () => ({ch:" ",style})),
  change: (changes,x,y,cell) => changes.push({x,y,cell}),
  controls: text => native.designDashboardBufferHasControls(text),
  segments: (text,style) => [{text,style}],
  parsedSegments: (text,style) => parseAnsi(text,style).flatMap((line,row) => policy("line",[line,row,style])),
  laterLine: (style,segments) => [{text:" ",style},...segments],
  expandTabs, graphemes, graphemeWidth,
  draw(screen,x,y,segments,rect,end) {
    const state={offset:0};
    for (const segment of segments) policy("segment",[screen,x,y,segment,rect,end,state]);
  },
  characters(screen,x,y,chars,segment,rect,end,state) {
    for (const ch of chars) if (policy("character",[screen,x,y,ch,segment,rect,end,state])) break;
  },
  startsWith: (value,prefix) => value.startsWith(prefix),
  backgroundName: value => `bg${value.charAt(0).toUpperCase()}${value.slice(1)}`,
  paint: (painter,text) => painter(text),
  invalidOperation() {throw new TypeError("Invalid dashboard buffer operation");}
});

export class ScreenBuffer {
  _width;
  _height;
  _cells;
  constructor(width,height) {policy("initialize",[this,width,height]);}
  get width() {return this._width;}
  get height() {return this._height;}
  put(x,y,text,style) {policy("put",[this,x,y,text,style]);}
  get(x,y) {return policy("get",[this,x,y]);}
  clear(style) {policy("clear",[this,style]);}
  clearRect(rect,style) {policy("clearRect",[this,rect,style]);}
  resize(width,height) {policy("resize",[this,width,height]);}
  putInRect(rect,row,text,style) {policy("putInRect",[this,rect,row,text,style]);}
  index(x,y) {return policy("index",[this,x,y]);}
  isInBounds(x,y) {return policy("isInBounds",[this,x,y]);}
  isInBoundsX(x) {return policy("isInBoundsX",[this,x]);}
  isInBoundsY(y) {return policy("isInBoundsY",[this,y]);}
}
export function diff(prev,next) {return policy("diff",[prev,next]);}
export function cellToAnsi(cell) {return policy("cellToAnsi",[cell]);}
