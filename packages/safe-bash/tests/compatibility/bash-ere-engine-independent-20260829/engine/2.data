import { EreLedger } from "./limits.js";
import { admitAscii, resolveEreProgram } from "./syntax.js";
import type { EreNode, EreProgram, EreResult, EreSpan } from "./types.js";

interface History {
  readonly span: EreSpan;
  readonly previous: History | null;
  readonly count: number;
}

type Task =
  | { readonly kind: "node"; readonly node: EreNode; readonly next: Task | null }
  | { readonly kind: "close"; readonly group: number; readonly start: number; readonly next: Task | null }
  | { readonly kind: "repeat"; readonly node: Extract<EreNode, { kind: "repeat" }>; readonly count: number; readonly previous: number; readonly next: Task | null };

interface State {
  readonly position: number;
  readonly task: Task | null;
  readonly captures: readonly (EreSpan | null)[];
  readonly histories: readonly (History | null)[];
}

function spanOrder(left: EreSpan | null, right: EreSpan | null): number {
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  const length = left.end - left.start - (right.end - right.start);
  return length === 0 ? right.start - left.start : length;
}

async function historyOrder(left: History | null, right: History | null, ledger: EreLedger, signal?: AbortSignal): Promise<number> {
  const leftCount = left?.count ?? 0;
  const rightCount = right?.count ?? 0;
  for (let ordinal = 1; ordinal <= Math.min(leftCount, rightCount); ordinal++) {
    ledger.charge("work", 1, signal);
    let leftEntry = left!;
    let rightEntry = right!;
    for (let remaining = leftCount; remaining > ordinal; remaining--) {
      ledger.charge("work", 1, signal);
      if (remaining % 256 === 0) await ledger.checkpoint(signal);
      leftEntry = leftEntry.previous!;
    }
    for (let remaining = rightCount; remaining > ordinal; remaining--) {
      ledger.charge("work", 1, signal);
      if (remaining % 256 === 0) await ledger.checkpoint(signal);
      rightEntry = rightEntry.previous!;
    }
    const compared = spanOrder(leftEntry.span, rightEntry.span);
    if (compared !== 0) return compared;
  }
  return leftCount - rightCount;
}

async function preferred(candidate: State, incumbent: State, ledger: EreLedger, signal?: AbortSignal): Promise<boolean> {
  if (candidate.position !== incumbent.position) return candidate.position > incumbent.position;
  for (let group = 1; group < candidate.captures.length; group++) {
    ledger.charge("work", 1, signal);
    const compared = await historyOrder(candidate.histories[group]!, incumbent.histories[group]!, ledger, signal);
    if (compared !== 0) return compared > 0;
  }
  return false;
}

export async function matchEre(program: EreProgram, subject: string, ledger: EreLedger, signal?: AbortSignal): Promise<EreResult> {
  ledger.check(signal);
  const root = resolveEreProgram(program, ledger);
  ledger.admitInput("subjectBytes", subject.length, signal);
  await admitAscii(subject, ledger, signal);
  const width = program.groups + 1;
  ledger.charge("allocationUnits", width * 2 + 1, signal);
  const emptyCaptures: readonly (EreSpan | null)[] = Object.freeze(new Array<EreSpan | null>(width).fill(null));
  const emptyHistories: readonly (History | null)[] = Object.freeze(new Array<History | null>(width).fill(null));
  const pending: State[] = [];
  const task = (create: () => Task): Task => {
    ledger.charge("allocationUnits", 5, signal);
    return create();
  };
  const push = (position: number, next: Task | null, captures: readonly (EreSpan | null)[], histories: readonly (History | null)[]): void => {
    ledger.charge("states", 1, signal);
    ledger.charge("allocationUnits", 5, signal);
    pending.push({ position, task: next, captures, histories });
  };
  for (let start = 0; start <= subject.length; start++) {
    push(start, task(() => ({ kind: "node", node: root, next: null })), emptyCaptures, emptyHistories);
    let best: State | undefined;
    while (pending.length > 0) {
      ledger.charge("work", 1, signal);
      await ledger.checkpoint(signal);
      const state = pending.pop()!;
      const current = state.task;
      if (current === null) {
        if (!best || await preferred(state, best, ledger, signal)) best = state;
        continue;
      }
      if (current.kind === "close") {
        ledger.charge("allocationUnits", width * 2 + 6, signal);
        const span = Object.freeze({ start: current.start, end: state.position });
        const captures = state.captures.slice();
        captures[current.group] = span;
        const histories = state.histories.slice();
        const previous = histories[current.group]!;
        histories[current.group] = { span, previous, count: (previous?.count ?? 0) + 1 };
        push(state.position, current.next, captures, histories);
        continue;
      }
      if (current.kind === "repeat") {
        const { node, count } = current;
        if (count >= node.min) push(state.position, current.next, state.captures, state.histories);
        const noProgress = count > 0 && state.position === current.previous;
        if (count < node.max && (!noProgress || count < node.min)) {
          const repeat = task(() => ({ kind: "repeat", node, count: count + 1, previous: state.position, next: current.next }));
          push(state.position, task(() => ({ kind: "node", node: node.child, next: repeat })), state.captures, state.histories);
        }
        continue;
      }
      const node = current.node;
      switch (node.kind) {
        case "empty": push(state.position, current.next, state.captures, state.histories); break;
        case "start": if (state.position === 0) push(state.position, current.next, state.captures, state.histories); break;
        case "end": if (state.position === subject.length) push(state.position, current.next, state.captures, state.histories); break;
        case "dot":
        case "literal":
        case "set": {
          const code = subject.charCodeAt(state.position);
          if (state.position < subject.length && (node.kind === "dot" || node.kind === "literal" && node.code === code || node.kind === "set" && node.members[code])) {
            push(state.position + 1, current.next, state.captures, state.histories);
          }
          break;
        }
        case "sequence": {
          let next = current.next;
          for (let index = node.children.length - 1; index >= 0; index--) {
            ledger.charge("work", 1, signal);
            const following = next;
            next = task(() => ({ kind: "node", node: node.children[index]!, next: following }));
          }
          push(state.position, next, state.captures, state.histories);
          break;
        }
        case "alternative":
          for (let index = node.children.length - 1; index >= 0; index--) {
            ledger.charge("work", 1, signal);
            push(state.position, task(() => ({ kind: "node", node: node.children[index]!, next: current.next })), state.captures, state.histories);
          }
          break;
        case "group": {
          const close = task(() => ({ kind: "close", group: node.index, start: state.position, next: current.next }));
          push(state.position, task(() => ({ kind: "node", node: node.child, next: close })), state.captures, state.histories);
          break;
        }
        case "repeat":
          push(state.position, task(() => ({ kind: "repeat", node, count: 0, previous: -1, next: current.next })), state.captures, state.histories);
          break;
      }
    }
    if (best) {
      ledger.charge("captureSlots", width, signal);
      let bytes = best.position - start;
      for (let group = 1; group < width; group++) {
        ledger.charge("work", 1, signal);
        const span = best.captures[group];
        if (span) bytes += span.end - span.start;
      }
      ledger.charge("captureBytes", bytes, signal);
      ledger.charge("allocationUnits", width * 2 + bytes + 4, signal);
      const captures = best.captures.slice();
      captures[0] = Object.freeze({ start, end: best.position });
      const values = captures.map(span => span === null ? "" : subject.slice(span.start, span.end));
      ledger.check(signal);
      return Object.freeze({ matched: true, captures: Object.freeze(captures), values: Object.freeze(values) });
    }
  }
  ledger.charge("allocationUnits", 3, signal);
  ledger.check(signal);
  return Object.freeze({ matched: false, captures: Object.freeze([] as const), values: Object.freeze([] as const) });
}
