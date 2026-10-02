import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {color} from "./color.js";
import {GLYPHS} from "./prompt-glyphs.js";
import {getColumns, getRows} from "./prompt-wrap.js";
import {wrapAnsi} from "./wrap-ansi.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
function countLines(values) {return values.reduce((sum, value) => sum + value.split("\n").length, 0);}
const invoke = createComponentPolicy(native.designPromptPaginationPolicy, {
  same: (a, b) => a === b, gt: (a, b) => a > b, lt: (a, b) => a < b, ge: (a, b) => a >= b,
  add: (a, b) => a + b, subtract: (a, b) => a - b, array: () => [],
  columns: (output, padding) => Math.max(1, getColumns(output) - padding),
  budget: (output, padding) => Math.max(getRows(output) - padding, 0),
  visibleCount: (maxItems, rowBudget) => Math.max(Math.min(maxItems, rowBudget), 5),
  cap: (count, options) => Math.min(count, options.length),
  nearEnd: (cursor, count) => cursor >= count - 3,
  start: (cursor, count, options) => Math.max(Math.min(cursor - count + 3, options.length - count), 0),
  visible: (options, start, end, style, cursor, columns) => options.slice(start, end).map((option, index) => wrapAnsi(style(option, start + index === cursor), columns, {hard: true, trim: false})),
  marker: columns => wrapAnsi(color.dim(GLYPHS.ellipsis), columns, {hard: true, trim: false}),
  markerRows: marker => marker.split("\n").length,
  neededRows: (visible, rows, start, end, options) => countLines(visible) + rows * (Number(start > 0) + Number(end < options.length)),
  remainingRows: (budget, visible) => budget - countLines(visible),
  shift: visible => visible.shift(), pop: visible => visible.pop(),
  unshift: (visible, marker) => visible.unshift(marker), push: (visible, marker) => visible.push(marker),
  invalidArguments() {throw new TypeError("Invalid pagination arguments");}
});
export function limitOptions(opts) {
  const {cursor, options, style, output, maxItems = Number.POSITIVE_INFINITY, columnPadding = 0, rowPadding = 4} = opts;
  return invoke("limit", [cursor, options, style, output, maxItems, columnPadding, rowPadding]);
}
