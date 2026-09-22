import type { Diff3Edit, Diff3File, Diff3Line, Diff3Options, Diff3Range, Diff3Region } from './contracts.js';
import type { Budget } from './budget.js';
import { equalLines } from './comparison.js';

/** Sweep two ordered edit streams without copying or expanding file content. */
export function alignRegions(files: Readonly<Record<Diff3File, readonly Diff3Line[]>>, left: readonly Diff3Edit[], right: readonly Diff3Edit[], options: Diff3Options, budget: Budget): Diff3Region[] {
  const streams = [left, right], offsets = [0, 0], delta = [0, 0], result: Diff3Region[] = [];
  while (offsets[0]! < left.length || offsets[1]! < right.length) {
    budget.admit('work', 1);
    const nextLeft = left[offsets[0]!], nextRight = right[offsets[1]!];
    const firstSide = nextRight === undefined || (nextLeft !== undefined && nextLeft.base.start <= nextRight.base.start) ? 0 : 1;
    const first = streams[firstSide]![offsets[firstSide]!]!;
    const start = first.base.start;
    let end = first.base.end;
    const initialDelta = [...delta], seen = [false, false];
    let overlap = false;
    const last: (Diff3Range | undefined)[] = [undefined, undefined];
    // Touching ranges are grouped as in GNU; true interval overlap remains
    // visible to callers instead of silently assuming generic merge semantics.
    for (;;) {
      budget.admit('work', 1);
      const a = left[offsets[0]!], b = right[offsets[1]!];
      const side = b === undefined || (a !== undefined && a.base.start <= b.base.start) ? 0 : 1;
      const edit = streams[side]![offsets[side]!];
      if (!edit || edit.base.start > end) break;
      const other = last[1 - side];
      if (other) {
        const aEmpty = edit.base.start === edit.base.end, bEmpty = other.start === other.end;
        overlap ||= aEmpty && bEmpty ? edit.base.start === other.start
          : aEmpty ? edit.base.start > other.start && edit.base.start < other.end
          : bEmpty ? other.start > edit.base.start && other.start < edit.base.end
          : edit.base.start < other.end && other.start < edit.base.end;
      }
      last[side] = edit.base; seen[side] = true;
      end = Math.max(end, edit.base.end);
      delta[side] = edit.variant.end - edit.base.end; offsets[side]!++;
    }
    const base = { start, end };
    const l = { start: start + initialDelta[0]!, end: end + delta[0]! }, r = { start: start + initialDelta[1]!, end: end + delta[1]! };
    let kind: Diff3Region['kind'] = !seen[0] ? 'right' : !seen[1] ? 'left' : overlap ? 'conflict' : 'adjacent';
    if (seen[0] && seen[1] && l.end - l.start === r.end - r.start) {
      let identical = true;
      for (let index = 0; index < l.end - l.start; index++) {
        if (!equalLines(files.left[l.start + index]!, files.right[r.start + index]!, options, budget)) { identical = false; break; }
      }
      if (identical) kind = 'identical';
    }
    budget.admit('graphCells', 7);
    result.push({ kind, base, left: l, right: r });
  }
  return result;
}
