import {createRequire} from "node:module";
import {types} from "node:util";
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
const bufferReads = Object.fromEntries(["width", "height", "get", "index", "isInBounds", "isInBoundsX", "isInBoundsY"]
  .map(key => [key, Object.getOwnPropertyDescriptor(ScreenBuffer.prototype, key)]));
const styleKeys = ["fg", "bg", "bold", "dim", "inverse", "underline"];

function snapshotCells(buffer) {
  if (!buffer || types.isProxy(buffer) || Object.getPrototypeOf(buffer) !== ScreenBuffer.prototype) return;
  for (const [key, expected] of Object.entries(bufferReads)) {
    const current = Object.getOwnPropertyDescriptor(ScreenBuffer.prototype, key);
    if (Object.hasOwn(buffer, key) || current?.value !== expected.value || current?.get !== expected.get) return;
  }
  const width = Object.getOwnPropertyDescriptor(buffer, "_width")?.value;
  const height = Object.getOwnPropertyDescriptor(buffer, "_height")?.value;
  const cells = Object.getOwnPropertyDescriptor(buffer, "_cells")?.value;
  if (!Number.isSafeInteger(width) || width < 0 || width > 0xffffffff ||
      !Number.isSafeInteger(height) || height < 0 || height > 0xffffffff ||
      !Array.isArray(cells) || types.isProxy(cells) || cells.length !== width * height) return;
  const snapshot = [];
  for (let index = 0; index < cells.length; index++) {
    const cell = Object.getOwnPropertyDescriptor(cells, index)?.value;
    if (!cell || types.isProxy(cell)) return;
    const ch = Object.getOwnPropertyDescriptor(cell, "ch")?.value;
    const style = Object.getOwnPropertyDescriptor(cell, "style")?.value;
    if (typeof ch !== "string" || !style || types.isProxy(style) || Object.getPrototypeOf(style) !== Object.prototype) return;
    const values = [ch];
    for (const key of styleKeys) {
      const field = Object.getOwnPropertyDescriptor(style, key);
      if (field && !Object.hasOwn(field, "value")) return;
      const value = field?.value;
      if (value !== undefined && typeof value !== (key === "fg" || key === "bg" ? "string" : "boolean")) return;
      values.push(value);
    }
    snapshot.push(JSON.stringify(values));
  }
  return {width, height, cells: snapshot};
}

export function diff(prev,next) {
  // Only inert own data can bypass the observable per-cell getter protocol.
  if (!styleKeys.some(key => Object.hasOwn(Object.prototype, key)) &&
      Object.getPrototypeOf(Array.prototype) === Object.prototype && !("toJSON" in [])) {
    const previous = snapshotCells(prev);
    const current = previous && snapshotCells(next);
    if (current && Math.max(previous.width, current.width) * Math.max(previous.height, current.height) <= 0xffffffff) {
      const width = Math.max(previous.width, current.width);
      return native.designDashboardBufferDiff(previous, current, '[" ",null,null,null,null,null,null]')
        .map(index => {
          const x = index % width, y = Math.floor(index / width);
          return {x, y, cell: next.get(x, y)};
        });
    }
  }
  return policy("diff",[prev,next]);
}
export function cellToAnsi(cell) {return policy("cellToAnsi",[cell]);}
