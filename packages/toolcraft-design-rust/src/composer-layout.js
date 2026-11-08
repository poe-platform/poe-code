import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {graphemes, graphemeWidth} from "./terminal.js";

const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const layouts = new WeakMap();
const invoke = createComponentPolicy(native.designComposerLayoutPolicy, {
  max: (a, b) => Math.max(a, b),
  cached: state => layouts.get(state),
  cachedText: cached => cached?.text,
  same: (a, b) => a === b,
  ge: (a, b) => a >= b,
  gt: (a, b) => a > b,
  add: (a, b) => a + b,
  frame: () => ({lines: [""], starts: [0], column: 0, offset: 0, cursor: {x: 0, y: 0}}),
  segments(frame, text, state, width) {
    for (const segment of graphemes(text)) invoke("step", [frame, segment, state, width]);
  },
  measure: graphemeWidth,
  lineBreak(frame, extra) {
    frame.lines.push("");
    frame.starts.push(frame.offset + extra);
    frame.column = 0;
  },
  markCursor: frame => { frame.cursor = {x: frame.column, y: frame.lines.length - 1}; },
  append(frame, text, cells) {
    frame.lines[frame.lines.length - 1] += text;
    frame.column += cells;
  },
  advance: (frame, segment) => { frame.offset += segment.length; },
  result: frame => ({lines: frame.lines, starts: frame.starts, cursor: frame.cursor}),
  cache: (state, text, cursor, width, layout) => layouts.set(state, {text, cursor, width, layout}),
  invalidOperation() { throw new TypeError("Invalid composer layout operation"); }
});

export function layoutComposer(state, width) {
  return invoke("layout", [state, width]);
}
