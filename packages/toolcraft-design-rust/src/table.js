import { createRequire } from "node:module";
import { resolveOutputFormat, stripAnsi } from "./logging.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const thrown = new WeakMap();
const protect = operation => (...args) => {
  try { return operation(...args); }
  catch (value) { const carrier = new Error("Table host operation failed"); thrown.set(carrier, value); throw carrier; }
};
let depth = 0;
function invoke(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return native.designTablePolicy(operation, args, host); }
  catch (error) { if (thrown.has(error)) throw thrown.get(error); throw error; }
  finally { depth--; }
}
const operations = {
  empty: () => "", left: () => "left", zero: () => 0, two: () => 2,
  true: () => true, false: () => false, minCellWidth: () => 4,
  truthy: value => !!value,
  array: () => [], finite: Number.isFinite,
  nonpositive: value => value <= 0, positive: value => value > 0, isZero: value => value === 0,
  multiple: value => value > 1, atMostOne: value => value <= 1,
  le: (a,b) => a <= b, lt: (a,b) => a < b, gt: (a,b) => a > b,
  add: (a,b) => a + b, subtract: (a,b) => a - b,
  increment: value => value + 1, plusTwo: value => value + 2,
  max: Math.max, minWidth: value => Math.max(1, value ?? 1),
  column: (name,title,alignment,width) => ({ name,title,alignment,width }),
  own: (row,name) => Object.prototype.hasOwnProperty.call(row,name),
  cellValue: (row,name) => row[name] ?? "",
  available: (max,count) => max - (count * 3 + 1),
  totalWidth: columns => columns.reduce((total,column) => total + column.width,0),
  contentWidth: (columns,cap) => columns.reduce((total,column) => total + Math.min(column.width,cap),0),
  capColumns: (columns,cap) => columns.map(column => ({ ...column,width: Math.min(column.width,cap) })),
  growable: (budgeted,columns) => budgeted.filter((column,index) => column.width < columns[index].width),
  emptyArray: value => value.length === 0,
  grow(columns,slack) {
    for (const column of columns) {
      if (slack === 0) break;
      column.width += 1;
      slack -= 1;
    }
    return slack;
  },
  at: (value,index) => value[index],
  slice: (value,start,end) => value.slice(start,end),
  suffix: (value,start) => value.slice(start),
  isAnsi: (value,index) => value[index] === "\x1b" && value[index + 1] === "[",
  ansiRecord: (sequence,nextIndex) => ({ sequence,nextIndex }),
  cluster(value,index) {
    const nextAnsiIndex = value.indexOf("\x1b[",index);
    const plainText = value.slice(index,nextAnsiIndex === -1 ? undefined : nextAnsiIndex);
    const first = segmenter.segment(plainText)[Symbol.iterator]().next().value;
    return first?.segment ?? Array.from(plainText)[0] ?? "";
  },
  points: cluster => Array.from(cluster).map(char => char.codePointAt(0) ?? 0),
  emoji: points => points.some(point => native.designTableEmojiPoint(point)),
  sumPoints: points => points.reduce((width,point) => width + native.designTablePointWidth(String.fromCodePoint(point).codePointAt(0) ?? 0),0),
  ellipsis: () => "…", reset: () => "\x1b[0m",
  truncated: (output,ellipsis,reset) => `${output}${ellipsis}${reset}`,
  padding: (width,visible) => Math.max(0,width - visible),
  padRight: (value,padding) => `${" ".repeat(padding)}${value}`,
  padLeft: (value,padding) => `${value}${" ".repeat(padding)}`,
  padCenter(value,padding) { const left = Math.floor(padding / 2), right = padding - left; return `${" ".repeat(left)}${value}${" ".repeat(right)}`; },
  templatePair: (a,b) => `${a}${b}`,
  push: (array,value) => array.push(value),
  setLine: (state,line) => { state.line = line; },
  joinWords: (line,word) => `${line} ${word}`,
  wrap(value,width) {
    const lines = [];
    for (const paragraph of value.split("\n")) {
      const state = { line: "" };
      for (const rawWord of paragraph.split(" ")) {
        const words = invoke("wrapWord",[rawWord,width]);
        for (const word of words) invoke("foldWord",[state,word,width,lines]);
      }
      lines.push(state.line);
    }
    return lines.length > 0 ? lines : [""];
  },
  loggerWidth: columns => columns - 3,
  labelWidth: width => Math.min(width,36),
  valueWidth: (max,label) => Math.max(20,(max ?? 80) - label - 2),
  continuation: label => " ".repeat(label + 2),
  detailRows: (rows,...args) => rows.flatMap(row => invoke("detailRow",[row,...args])).join("\n"),
  blankDetail: values => values.length === 1 && values[0] === "",
  detailHeader: (theme,label) => [theme.header(label)],
  detailLines: (theme,label,width,alignment,values,continuation) => [
    `${theme.muted(invoke("pad",[label,width,alignment]))}  ${values[0] ?? ""}`,
    ...values.slice(1).map(value => `${continuation}${value}`)
  ],
  terminal(options) {
    const { theme,columns,rows } = options;
    const computed = columns.map(column => invoke("column",[column]));
    return invoke("terminal",[options,theme,computed,rows]);
  },
  table(options,theme,columns,rows) {
    const separators = invoke("separators",[options]);
    const budgeted = invoke("budget",[columns,options.maxWidth ?? process.stdout.columns]);
    const top = renderBorder(budgeted,theme,{ left:"┌",mid:"┬",right:"┐" });
    const header = renderRow(budgeted.map(column => theme.header(column.title)),budgeted,theme);
    const headerBottom = renderBorder(budgeted,theme,{ left:"├",mid:"┼",right:"┤" });
    const bottom = renderBorder(budgeted,theme,{ left:"└",mid:"┴",right:"┘" });
    const rendered = [];
    for (const [index,row] of rows.entries()) {
      if (separators && index > 0) rendered.push(headerBottom);
      rendered.push(renderRow(budgeted.map(column => invoke("cell",[row,column.name])),budgeted,theme));
    }
    return [top,header,headerBottom,...rendered,bottom].join("\n");
  },
  markdown(options) {
    const { columns,rows } = options;
    const header = `| ${columns.map(column => markdownCell(column.title)).join(" | ")} |`;
    const separator = `| ${columns.map(column => {
      const alignment = invoke("alignment",[column]);
      return alignment === "right" ? "---:" : alignment === "center" ? ":---:" : ":---";
    }).join(" | ")} |`;
    const data = rows.map(row => `| ${columns.map(column => markdownCell(invoke("cell",[row,column.name]))).join(" | ")} |`);
    return [header,separator,...data].join("\n");
  },
  json(options) {
    const { columns,rows } = options;
    const cleaned = rows.map(row => {
      const object = Object.create(null);
      for (const column of columns) object[column.name] = stripAnsi(invoke("cell",[row,column.name]));
      return object;
    });
    return JSON.stringify(cleaned,null,2);
  },
  invalidWidth() { throw new Error("maxLen must be a positive finite number."); },
  invalidOperation() { throw new TypeError("Invalid table operation"); }
};
const host = { operate: protect((name,args) => operations[name](...args)), get: protect((value,key) => value[key]) };

function markdownCell(value) {
  return stripAnsi(value).replaceAll("\r\n"," ").replaceAll("\n"," ").replaceAll("\r"," ").replaceAll("|","\\|");
}
function renderBorder(columns,theme,parts) {
  const horizontal = theme.muted("─");
  const segments = columns.map(column => horizontal.repeat(column.width + 2));
  return [theme.muted(parts.left),segments.join(theme.muted(parts.mid)),theme.muted(parts.right)].join("");
}
function renderRow(values,columns,theme) {
  const vertical = theme.muted("│");
  const cells = values.map((value,index) => {
    const column = columns[index];
    const truncated = invoke("truncate",[value,column.width]);
    return ` ${invoke("pad",[truncated,column.width,column.alignment])} `;
  });
  return `${vertical}${cells.join(vertical)}${vertical}`;
}
export function renderTable(options) { return invoke("render",[options,resolveOutputFormat()]); }
export function loggerTableWidth() { const columns = process.stdout.columns; return invoke("loggerWidth",[columns]); }
