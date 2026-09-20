import { parseAnsi } from "./ansi.js";
import { graphemes, graphemeWidth } from "./terminal-width.js";
import { layoutComposer } from "./composer-layout.js";
import type { KeypressEvent } from "./terminal.js";

const editingSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export type DashboardSubmission = {
  kind: "message" | "plan";
  text: string;
  afterPlanId?: string;
};

export type ComposerState = {
  kind: DashboardSubmission["kind"];
  text: string;
  /** UTF-16 offset at a grapheme boundary. */
  cursor: number;
  focused: boolean;
  afterPlanId?: string;
  error?: string;
  /** Preserve the intended display column across shorter rows during vertical movement. */
  preferredColumn?: number;
  preferredWidth?: number;
};

export function createComposerState(kind: DashboardSubmission["kind"], afterPlanId?: string): ComposerState {
  return { kind, text: "", cursor: 0, focused: true, ...(afterPlanId ? { afterPlanId } : {}) };
}

export function editComposer(state: ComposerState, event: KeypressEvent, width = Number.MAX_SAFE_INTEGER): {
  state: ComposerState;
  handled: boolean;
  submit?: DashboardSubmission;
} {
  const key = event.name ?? event.ch;
  if (!state.focused || (event.ctrl && key === "c")) return { state, handled: false };
  if (key === "escape") return { state: { ...state, focused: false }, handled: true };
  const next: ComposerState = { ...state, error: undefined, preferredColumn: undefined, preferredWidth: undefined };
  if ((key === "up" || key === "down") && !event.ctrl && !event.meta) {
    const layout = layoutComposer(state, width);
    const row = Math.max(0, Math.min(layout.starts.length - 1, layout.cursor.y + (key === "up" ? -1 : 1)));
    if (row === layout.cursor.y) return { state, handled: true };
    next.preferredColumn = (state.preferredWidth === width ? state.preferredColumn : undefined) ?? layout.cursor.x;
    next.preferredWidth = width;
    next.cursor = layout.starts[row]!;
    let column = 0;
    for (const segment of graphemes(state.text.slice(next.cursor, layout.starts[row + 1]))) {
      const cells = segment === "\t" ? 2 : graphemeWidth(segment);
      if (segment === "\n" || column + cells > next.preferredColumn) break;
      next.cursor += segment.length;
      column += cells;
    }
    return { state: next, handled: true };
  }
  const segments = ["left", "right", "backspace", "delete"].includes(key ?? "") || (event.ctrl && (key === "d" || key === "w"))
    ? editingSegmenter.segment(state.text) : undefined;
  const previous = segments?.containing(state.cursor - 1)?.index ?? state.cursor;
  const current = segments?.containing(state.cursor);
  const following = current ? current.index + current.segment.length : state.cursor;
  const lineStart = state.cursor === 0 ? 0 : state.text.lastIndexOf("\n", state.cursor - 1) + 1;
  const newline = state.text.indexOf("\n", state.cursor);
  const lineEnd = newline === -1 ? state.text.length : newline;

  function replace(start: number, end: number, text = ""): void {
    next.text = state.text.slice(0, start) + text + state.text.slice(end);
    next.cursor = start + text.length;
  }

  if (event.name === "paste") {
    const text = parseAnsi((event.ch ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n"))
      .map((line) => line.segments.map((segment) => segment.text).join(""))
      .join("\n");
    replace(state.cursor, state.cursor, text);
  } else if ((key === "return" || key === "enter") && (event.meta || event.shift)) {
    replace(state.cursor, state.cursor, "\n");
  } else if (key === "return" || key === "enter" || key === "tab") {
    if (!state.text.trim()) return { state, handled: true };
    return { state, handled: true, submit: {
      kind: state.kind,
      text: state.text.trim(),
      ...(state.kind === "message" && state.afterPlanId ? { afterPlanId: state.afterPlanId } : {})
    } };
  } else if (key === "left" && !event.meta) {
    next.cursor = previous;
  } else if (key === "right" && !event.meta) {
    next.cursor = following;
  } else if (key === "home" || (event.ctrl && key === "a")) {
    next.cursor = lineStart;
  } else if (key === "end" || (event.ctrl && key === "e")) {
    next.cursor = lineEnd;
  } else if (key === "backspace") {
    replace(previous, state.cursor);
  } else if (key === "delete" || (event.ctrl && key === "d")) {
    replace(state.cursor, following);
  } else if (event.ctrl && key === "u") {
    replace(lineStart, state.cursor);
  } else if (event.ctrl && key === "k") {
    replace(state.cursor, lineEnd);
  } else if (event.ctrl && key === "w") {
    let start = state.cursor;
    let preceding = segments?.containing(start - 1);
    while (preceding && preceding.segment.trim() === "") {
      start = preceding.index;
      preceding = segments?.containing(start - 1);
    }
    while (preceding && preceding.segment.trim() !== "") {
      start = preceding.index;
      preceding = segments?.containing(start - 1);
    }
    replace(start, state.cursor);
  } else if (event.ch !== undefined && !event.ctrl && !event.meta) {
    replace(state.cursor, state.cursor, event.ch);
  } else {
    return { state, handled: false };
  }
  return { state: next, handled: true };
}
