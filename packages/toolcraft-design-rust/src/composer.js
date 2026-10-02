import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {parseAnsi} from "./dashboard-ansi.js";
import {graphemes, graphemeWidth} from "./terminal.js";
import {layoutComposer} from "./composer-layout.js";

const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const editingSegmenter = new Intl.Segmenter(undefined, {granularity: "grapheme"});
const invoke = createComponentPolicy(native.designComposerPolicy, {
  truthy: value => !!value, nullish: value => value == null, same: (a, b) => a === b,
  undefined: () => undefined, true: () => true, false: () => false,
  add: (a, b) => a + b, gt: (a, b) => a > b,
  create: kind => ({kind, text: "", cursor: 0, focused: true}),
  afterPlan: (value, afterPlanId) => {
    Object.defineProperty(value, "afterPlanId", {value: afterPlanId, writable: true, enumerable: true, configurable: true});
  },
  handled: state => ({state, handled: true}), unhandled: state => ({state, handled: false}),
  escape: state => ({state: {...state, focused: false}, handled: true}),
  next: state => ({...state, error: undefined, preferredColumn: undefined, preferredWidth: undefined}),
  layout: layoutComposer,
  row: (layout, direction) => Math.max(0, Math.min(layout.starts.length - 1, layout.cursor.y + direction)),
  preferred(next, column, width) { next.preferredColumn = column; next.preferredWidth = width; },
  startCursor: (next, layout, row) => { next.cursor = layout.starts[row]; },
  verticalSegments(state, next, layout, row) {
    const frame = {column: 0};
    for (const segment of graphemes(state.text.slice(next.cursor, layout.starts[row + 1]))) {
      if (!invoke("verticalStep", [frame, next, segment])) break;
    }
  },
  measure: graphemeWidth,
  advance(frame, next, segment, cells) { next.cursor += segment.length; frame.column += cells; },
  segment: state => editingSegmenter.segment(state.text),
  previous: (segments, state) => segments?.containing(state.cursor - 1)?.index ?? state.cursor,
  current: (segments, state) => segments?.containing(state.cursor),
  following: (current, state) => current ? current.index + current.segment.length : state.cursor,
  lineStart: state => state.text.lastIndexOf("\n", state.cursor - 1) + 1,
  newline: state => state.text.indexOf("\n", state.cursor),
  replace(next, state, start, end, text = "") {
    next.text = state.text.slice(0, start) + text + state.text.slice(end);
    next.cursor = start + text.length;
  },
  paste: event => parseAnsi((event.ch ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n"))
    .map(line => line.segments.map(segment => segment.text).join("")).join("\n"),
  trimState: state => state.text.trim(),
  submission: (kind, text) => ({kind, text}),
  submitted: (state, submit) => ({state, handled: true, submit}),
  cursor: (next, value) => { next.cursor = value; },
  before: (segments, start) => segments?.containing(start - 1),
  trimSegment: preceding => preceding.segment.trim(),
  invalidOperation() { throw new TypeError("Invalid composer operation"); }
});

export function createComposerState(kind, afterPlanId) {
  return invoke("create", [kind, afterPlanId]);
}
export function editComposer(state, event, width = Number.MAX_SAFE_INTEGER) {
  return invoke("edit", [state, event, width]);
}
