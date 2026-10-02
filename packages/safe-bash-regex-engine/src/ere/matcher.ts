import { validateUtf8 } from "../utf8.js";
import { foldAscii, isAsciiWord } from "../ascii.js";
import { EreLedger } from "./limits.js";
import { admitAscii, resolveEreProgram, resolveEreProgramUnchecked } from "./syntax.js";
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

// Tasks are recreated while expanding alternatives. Compare their semantics,
// not object identities; captures are deliberately absent in this span path.
function spanStateKey(position: number, task: Task | null, nodeIds: Map<EreNode, number>): string {
  let key = String(position);
  for (let current = task; current; current = current.next) {
    if (current.kind === "close") return `${key}/close`;
    let id = nodeIds.get(current.node);
    if (id === undefined) { id = nodeIds.size; nodeIds.set(current.node, id); }
    key += `/${id}`;
    if (current.kind === "repeat") {
      const count = current.node.max === Infinity ? Math.min(current.count, Math.max(1, current.node.min)) : current.count;
      key += `:${count}:${current.previous === position ? 1 : 0}`;
    }
  }
  return key;
}

interface State {
  readonly position: number;
  readonly task: Task | null;
  readonly captures: readonly (EreSpan | null)[];
  readonly histories: readonly (History | null)[];
}

const initialCharacters = /* @__PURE__ */ new WeakMap<EreNode, readonly boolean[]>();
const sequenceNullNextTasks = /* @__PURE__ */ new WeakMap<EreNode, Task>();
const SINGLE_NULL_CAPTURES: readonly (EreSpan | null)[] = /* @__PURE__ */ Object.freeze([null]);
const SINGLE_NULL_HISTORIES: readonly (History | null)[] = /* @__PURE__ */ Object.freeze([null]);

interface FastEreLiteralSeq {
  readonly anchoredStart: boolean;
  readonly anchoredEnd: boolean;
  readonly codes: Uint8Array;
  readonly insensitive: boolean;
  readonly spanAtZero: EreSpan;
}
const fastLiteralSeqs = /* @__PURE__ */ new WeakMap<EreNode, FastEreLiteralSeq | null>();

interface FastErePrefixAlt {
  readonly anchoredStart: boolean;
  readonly anchoredEnd: boolean;
  readonly prefix: Uint8Array;
  readonly alts: readonly Uint8Array[] | null;
}
const fastPrefixAlts = /* @__PURE__ */ new WeakMap<EreNode, FastErePrefixAlt | null>();

function extractLiteralBytes(node: EreNode): Uint8Array | null {
  if (node.kind === "literal") {
    return node.insensitive ? null : Uint8Array.of(node.code);
  }
  if (node.kind === "group") {
    return extractLiteralBytes(node.child);
  }
  if (node.kind === "sequence") {
    const out: number[] = [];
    for (const c of node.children) {
      if (c.kind === "literal" && !c.insensitive) out.push(c.code);
      else return null;
    }
    return out.length > 0 ? Uint8Array.from(out) : null;
  }
  return null;
}

function getFastErePrefixAlt(root: EreNode): FastErePrefixAlt | null {
  const existing = fastPrefixAlts.get(root);
  if (existing !== undefined) return existing;
  let anchoredStart = false;
  let anchoredEnd = false;
  const prefixBytes: number[] = [];
  let alts: Uint8Array[] | null = null;
  const nodes: readonly EreNode[] = root.kind === "sequence" ? root.children : [root];
  let idx = 0;
  let endIdx = nodes.length;
  if (idx < endIdx && nodes[idx]!.kind === "start") {
    anchoredStart = true;
    idx++;
  }
  if (idx < endIdx && nodes[endIdx - 1]!.kind === "end") {
    anchoredEnd = true;
    endIdx--;
  }
  while (idx < endIdx) {
    const n = nodes[idx]!;
    if (n.kind === "literal" && !n.insensitive) {
      prefixBytes.push(n.code);
      idx++;
    } else {
      break;
    }
  }
  if (idx === endIdx - 1) {
    let tail = nodes[idx]!;
    while (tail.kind === "group") tail = tail.child;
    if (tail.kind === "alternative" && tail.children.length > 0) {
      const branches: Uint8Array[] = [];
      let ok = true;
      for (const b of tail.children) {
        const bytes = extractLiteralBytes(b);
        if (!bytes || bytes.length === 0) { ok = false; break; }
        branches.push(bytes);
      }
      if (ok) {
        alts = branches;
        idx++;
      }
    }
  }
  if (idx !== endIdx || (prefixBytes.length === 0 && alts === null)) {
    fastPrefixAlts.set(root, null);
    return null;
  }
  const created: FastErePrefixAlt = {
    anchoredStart,
    anchoredEnd,
    prefix: Uint8Array.from(prefixBytes),
    alts,
  };
  fastPrefixAlts.set(root, created);
  return created;
}

function getFastEreLiteralSeq(root: EreNode): FastEreLiteralSeq | null {
  const existing = fastLiteralSeqs.get(root);
  if (existing !== undefined) return existing;
  let anchoredStart = false;
  let anchoredEnd = false;
  let insensitive = false;
  const bytes: number[] = [];
  if (root.kind === "literal") {
    insensitive = root.insensitive;
    bytes.push(insensitive ? foldAscii(root.code) : root.code);
  } else if (root.kind === "sequence") {
    const children = root.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (child.kind === "start") {
        if (i !== 0) { fastLiteralSeqs.set(root, null); return null; }
        anchoredStart = true;
      } else if (child.kind === "end") {
        if (i !== children.length - 1) { fastLiteralSeqs.set(root, null); return null; }
        anchoredEnd = true;
      } else if (child.kind === "literal") {
        if (bytes.length === 0) insensitive = child.insensitive;
        else if (insensitive !== child.insensitive) { fastLiteralSeqs.set(root, null); return null; }
        bytes.push(insensitive ? foldAscii(child.code) : child.code);
      } else {
        fastLiteralSeqs.set(root, null);
        return null;
      }
    }
  } else {
    fastLiteralSeqs.set(root, null);
    return null;
  }
  const codes = Uint8Array.from(bytes);
  const created: FastEreLiteralSeq = {
    anchoredStart,
    anchoredEnd,
    codes,
    insensitive,
    spanAtZero: Object.freeze({ start: 0, end: codes.length }),
  };
  fastLiteralSeqs.set(root, created);
  return created;
}

function getSequenceNullNextTask(node: Extract<EreNode, { readonly children: readonly EreNode[] }>): Task {
  let cached = sequenceNullNextTasks.get(node);
  if (!cached) {
    let next: Task | null = null;
    for (let index = node.children.length - 1; index >= 0; index--) {
      next = { kind: "node", node: node.children[index]!, next };
    }
    cached = next!;
    sequenceNullNextTasks.set(node, cached);
  }
  return cached;
}

const warmLedger = /* @__PURE__ */ EreLedger.withPrevalidatedLimits({
  patternBytes: Infinity,
  subjectBytes: Infinity,
  work: Infinity,
  states: Infinity,
  allocationUnits: Infinity,
  captureBytes: Infinity,
  captureSlots: Infinity,
});

export async function warmEreProgram(program: EreProgram): Promise<void> {
  const root = resolveEreProgramUnchecked(program);
  await prepareInitialCharacters(root, warmLedger);
}

export function canFastSyncEreProgram(_program: EreProgram): boolean {
  return true;
}

export function tryMatchEreAsciiRangeSync(
  program: EreProgram,
  buf: Uint8Array,
  rStart: number,
  rEnd: number,
  ledger: EreLedger,
  signal: AbortSignal | undefined,
  leftmostFirst = false,
  word = false,
  skipPerRowLedgerCharge = false,
): EreSpan | undefined | null {
  const root = resolveEreProgramUnchecked(program);
  if (program.groups !== 0) {
    if (
      !skipPerRowLedgerCharge ||
      ledger.limits.work !== Infinity ||
      ledger.limits.states !== Infinity ||
      ledger.limits.allocationUnits !== Infinity ||
      ledger.limits.captureBytes !== Infinity ||
      ledger.limits.captureSlots !== Infinity
    ) {
      return null;
    }
  }
  const initial = root.nullable ? undefined : initialCharacters.get(root);
  if (!root.nullable && !initial) return null;
  const rLen = rEnd - rStart;
  if (!skipPerRowLedgerCharge) {
    ledger.check(signal);
    ledger.admitInput("subjectBytes", rLen, signal);
    ledger.charge("allocationUnits", rLen * 11 + 23, signal);
    ledger.chargeWork(rLen * 4 + 4, signal);
  }
  const fastSeq = getFastEreLiteralSeq(root);
  if (fastSeq !== null) {
    const { anchoredStart, anchoredEnd, codes, insensitive, spanAtZero } = fastSeq;
    const patLen = codes.length;
    if (rLen < patLen || (anchoredStart && anchoredEnd && rLen !== patLen)) {
      if (!skipPerRowLedgerCharge) ledger.chargeWork(1, signal);
      return undefined;
    }
    if (anchoredStart) {
      if (!skipPerRowLedgerCharge) ledger.chargeWork(1 + patLen, signal);
      if (!insensitive) {
        for (let i = 0; i < patLen; i++) {
          if (buf[rStart + i] !== codes[i]) return undefined;
        }
      } else {
        for (let i = 0; i < patLen; i++) {
          if (foldAscii(buf[rStart + i]!) !== codes[i]) return undefined;
        }
      }
      if (word && patLen > 0 && patLen < rLen && isAsciiWord(buf[rStart + patLen]!)) return undefined;
      return spanAtZero;
    }
    if (anchoredEnd && !word) {
      const start = rLen - patLen;
      if (!skipPerRowLedgerCharge) ledger.chargeWork(1 + patLen, signal);
      if (!insensitive) {
        for (let i = 0; i < patLen; i++) {
          if (buf[rStart + start + i] !== codes[i]) return undefined;
        }
      } else {
        for (let i = 0; i < patLen; i++) {
          if (foldAscii(buf[rStart + start + i]!) !== codes[i]) return undefined;
        }
      }
      return start === 0 ? spanAtZero : { start, end: rLen };
    }
  }
  if (
    ledger.limits.work === Infinity &&
    ledger.limits.states === Infinity &&
    ledger.limits.allocationUnits === Infinity
  ) {
    const fastPA = getFastErePrefixAlt(root);
    if (fastPA !== null && fastPA.prefix.length > 0) {
      const { anchoredStart, anchoredEnd, prefix, alts } = fastPA;
      const pLen = prefix.length;
      const p0 = prefix[0]!;
      let searchPos = rStart;
      const maxSearch = anchoredStart ? rStart : rEnd - pLen;
      while (searchPos <= maxSearch) {
        const foundAbs = anchoredStart ? (buf[rStart] === p0 ? rStart : -1) : buf.indexOf(p0, searchPos);
        if (foundAbs < 0 || foundAbs > maxSearch) break;
        const relStart = foundAbs - rStart;
        let prefixOk = true;
        for (let k = 1; k < pLen; k++) {
          if (buf[foundAbs + k] !== prefix[k]) { prefixOk = false; break; }
        }
        if (prefixOk && (!word || relStart === 0 || !isAsciiWord(buf[foundAbs - 1]!))) {
          if (alts === null) {
            const relEnd = relStart + pLen;
            if ((!anchoredEnd || relEnd === rLen) && (!word || relEnd === rLen || !isAsciiWord(buf[rStart + relEnd]!))) {
              return { start: relStart, end: relEnd };
            }
          } else {
            let bestEnd = -1;
            const afterPrefixAbs = foundAbs + pLen;
            for (let a = 0; a < alts.length; a++) {
              const alt = alts[a]!;
              const aLen = alt.length;
              if (afterPrefixAbs + aLen > rEnd) continue;
              let altOk = true;
              for (let k = 0; k < aLen; k++) {
                if (buf[afterPrefixAbs + k] !== alt[k]) { altOk = false; break; }
              }
              if (!altOk) continue;
              const relEnd = relStart + pLen + aLen;
              if (anchoredEnd && relEnd !== rLen) continue;
              if (word && relEnd < rLen && isAsciiWord(buf[rStart + relEnd]!)) continue;
              if (leftmostFirst) { bestEnd = relEnd; break; }
              if (relEnd > bestEnd) bestEnd = relEnd;
            }
            if (bestEnd >= 0) return { start: relStart, end: bestEnd };
          }
        }
        if (anchoredStart) break;
        searchPos = foundAbs + 1;
      }
      return undefined;
    }
  }
  const unbounded =
    skipPerRowLedgerCharge &&
    ledger.limits.work === Infinity &&
    ledger.limits.states === Infinity &&
    ledger.limits.allocationUnits === Infinity;
  return tryMatchEreAsciiRangeNfaSync(root, initial, buf, rStart, rLen, ledger, signal, leftmostFirst, word, unbounded);
}

function tryMatchEreAsciiRangeNfaSync(
  root: EreNode,
  initial: readonly boolean[] | undefined,
  buf: Uint8Array,
  rStart: number,
  rLen: number,
  ledger: EreLedger,
  signal: AbortSignal | undefined,
  leftmostFirst: boolean,
  word: boolean,
  unbounded = false,
): EreSpan | undefined | null {
  let firstLitCode = -1;
  let secondLitCode = -1;
  let rootSeqLen = 0;
  if (root.kind === "sequence" && root.children.length >= 1) {
    const c0 = root.children[0]!;
    if (c0.kind === "literal" && !c0.insensitive) {
      firstLitCode = c0.code;
      if (root.children.length >= 2) {
        const c1 = root.children[1]!;
        if (c1.kind === "literal" && !c1.insensitive) {
          secondLitCode = c1.code;
          rootSeqLen = root.children.length;
        }
      }
    }
  }
  if (unbounded) {
    if (signal?.aborted) throw signal.reason;
    const nodeIds = new Map<EreNode, number>();
    const seen = new Set<string>();
    const pendingPos: number[] = [];
    const pendingTask: (Task | null)[] = [];
    const push = (position: number, next: Task | null): void => {
      const key = spanStateKey(position, next, nodeIds);
      if (seen.has(key)) return;
      seen.add(key);
      pendingPos.push(position);
      pendingTask.push(next);
    };
    const rootTask: Task = root.kind === "sequence"
      ? getSequenceNullNextTask(root)
      : { kind: "node", node: root, next: null };
    const anchored = root.kind === "start" || (root.kind === "sequence" && root.children[0]?.kind === "start");
    const maxStart = anchored ? 0 : rLen;
    for (let start = 0; start <= maxStart; start++) {
      if (ledger.workAllowanceUntilCheckpoint(signal) < 1) return null;
      ledger.chargeWork(1, signal);
      if (firstLitCode >= 0 && !anchored) {
        const found = buf.indexOf(firstLitCode, rStart + start);
        if (found < 0 || found >= rStart + rLen) break;
        start = found - rStart;
      } else if (initial) {
        const firstCode = start < rLen ? buf[rStart + start]! : -1;
        if (firstCode < 0 || !initial[firstCode]) continue;
      }
      if (word && start > 0 && isAsciiWord(buf[rStart + start - 1]!)) continue;
      if (secondLitCode >= 0 && (start + 1 >= rLen || buf[rStart + start + 1] !== secondLitCode)) continue;
      seen.clear();
      push(start, rootTask);
      let bestPos = -1;
      while (pendingPos.length > 0) {
        if (ledger.workAllowanceUntilCheckpoint(signal) < 1) return null;
        ledger.chargeWork(1, signal);
        const statePos = pendingPos.pop()!;
        const current = pendingTask.pop()!;
        if (current === null) {
          if (word && statePos < rLen && isAsciiWord(buf[rStart + statePos]!)) continue;
          if (leftmostFirst || statePos === rLen) { bestPos = statePos; pendingPos.length = 0; pendingTask.length = 0; break; }
          if (statePos > bestPos) bestPos = statePos;
          continue;
        }
        if (current.kind === "repeat") {
          const { node, count } = current;
          if (count === 0 && node.child.kind === "dot" && node.max === Infinity) {
            let maxDotPos = rLen;
            if (leftmostFirst) {
              const nl = buf.indexOf(10, rStart + statePos);
              if (nl >= 0 && nl < rStart + rLen) maxDotPos = nl - rStart;
            }
            const minDotPos = statePos + node.min;
            if (minDotPos <= maxDotPos) {
              const scanWork = maxDotPos - minDotPos + 1;
              if (ledger.workAllowanceUntilCheckpoint(signal) < scanWork) return null;
              ledger.chargeWork(scanWork, signal);
              const nextTask = current.next;
              if (nextTask && nextTask.kind === "node" && nextTask.node.kind === "literal" && !nextTask.node.insensitive) {
                const targetCode = nextTask.node.code;
                const afterLit = nextTask.next;
                for (let p = minDotPos; p <= maxDotPos && p < rLen; p++) {
                  if (buf[rStart + p] === targetCode) push(p + 1, afterLit);
                }
              } else {
                for (let p = minDotPos; p <= maxDotPos; p++) {
                  push(p, nextTask);
                }
              }
            }
            continue;
          }
          if (count >= node.min) push(statePos, current.next);
          const noProgress = count > 0 && statePos === current.previous;
          if (count < node.max && (!noProgress || count < node.min)) {
            const repeat: Task = { kind: "repeat", node, count: count + 1, previous: statePos, next: current.next };
            push(statePos, { kind: "node", node: node.child, next: repeat });
          }
          continue;
        }
        if (current.kind === "close") return null;
        const node = current.node;
        switch (node.kind) {
          case "empty": push(statePos, current.next); break;
          case "start": if (statePos === 0) push(statePos, current.next); break;
          case "end": if (statePos === rLen) push(statePos, current.next); break;
          case "dot":
          case "literal":
          case "set": {
            if (statePos < rLen) {
              const code = buf[rStart + statePos]!;
              if (
                (node.kind === "dot" && (!leftmostFirst || code !== 10)) ||
                (node.kind === "literal" && (node.insensitive ? foldAscii(node.code) === foldAscii(code) : node.code === code)) ||
                (node.kind === "set" && (code < 128 ? node.members[code] : node.nonAscii))
              ) {
                push(statePos + 1, current.next);
              }
            }
            break;
          }
          case "sequence": {
            if (current.next === null) {
              push(statePos, getSequenceNullNextTask(node));
            } else {
              let next = current.next;
              for (let index = node.children.length - 1; index >= 0; index--) {
                next = { kind: "node", node: node.children[index]!, next };
              }
              push(statePos, next);
            }
            break;
          }
          case "alternative":
            for (let index = node.children.length - 1; index >= 0; index--) {
              push(statePos, { kind: "node", node: node.children[index]!, next: current.next });
            }
            break;
          case "group":
            push(statePos, { kind: "node", node: node.child, next: current.next });
            break;
          case "repeat":
            push(statePos, { kind: "repeat", node, count: 0, previous: -1, next: current.next });
            break;
        }
      }
      if (bestPos >= 0) return { start, end: bestPos };
    }
    return undefined;
  }
  const pending: State[] = [];
  const push = (position: number, next: Task | null): void => {
    ledger.charge("states", 1, signal);
    ledger.charge("allocationUnits", 5, signal);
    pending.push({ position, task: next, captures: SINGLE_NULL_CAPTURES, histories: SINGLE_NULL_HISTORIES });
  };
  const rootTask: Task = root.kind === "sequence"
    ? getSequenceNullNextTask(root)
    : { kind: "node", node: root, next: null };
  const maxStart = (root.kind === "start" || (root.kind === "sequence" && root.children[0]?.kind === "start")) ? 0 : rLen;
  for (let start = 0; start <= maxStart; start++) {
    if (initial) {
      ledger.chargeWork(1, signal);
      const firstCode = start < rLen ? buf[rStart + start]! : -1;
      if (firstCode < 0 || !initial[firstCode]) continue;
    }
    if (word) {
      ledger.chargeWork(1, signal);
      if (start > 0 && isAsciiWord(buf[rStart + start - 1]!)) continue;
    }
    if (secondLitCode >= 0) {
      if (start + 1 >= rLen || buf[rStart + start + 1] !== secondLitCode) {
        ledger.chargeWork(3 + rootSeqLen, signal);
        ledger.charge("states", 3, signal);
        ledger.charge("allocationUnits", (rootSeqLen + 1) * 5 + 15, signal);
        continue;
      }
    }
    if (root.kind === "sequence") {
      ledger.charge("allocationUnits", 5, signal);
      ledger.charge("states", 1, signal);
      ledger.charge("allocationUnits", 5, signal);
      ledger.chargeWork(1 + root.children.length, signal);
      ledger.charge("allocationUnits", root.children.length * 5, signal);
      push(start, rootTask);
    } else {
      ledger.charge("allocationUnits", 5, signal);
      push(start, rootTask);
    }
    let bestPos = -1;
    while (pending.length > 0) {
      if (ledger.workAllowanceUntilCheckpoint(signal) < 64) return null;
      ledger.chargeWork(1, signal);
      const state = pending.pop()!;
      const current = state.task;
      if (current === null) {
        if (word && state.position < rLen && isAsciiWord(buf[rStart + state.position]!)) continue;
        if (leftmostFirst) { bestPos = state.position; pending.length = 0; break; }
        if (state.position > bestPos) bestPos = state.position;
        continue;
      }
      if (current.kind === "repeat") {
        const { node, count } = current;
        if (count >= node.min) push(state.position, current.next);
        const noProgress = count > 0 && state.position === current.previous;
        if (count < node.max && (!noProgress || count < node.min)) {
          ledger.charge("allocationUnits", 10, signal);
          const repeat: Task = { kind: "repeat", node, count: count + 1, previous: state.position, next: current.next };
          push(state.position, { kind: "node", node: node.child, next: repeat });
        }
        continue;
      }
      if (current.kind === "close") return null;
      const node = current.node;
      switch (node.kind) {
        case "empty": push(state.position, current.next); break;
        case "start": if (state.position === 0) push(state.position, current.next); break;
        case "end": if (state.position === rLen) push(state.position, current.next); break;
        case "dot":
        case "literal":
        case "set": {
          if (state.position < rLen) {
            const code = buf[rStart + state.position]!;
            if (
              (node.kind === "dot" && (!leftmostFirst || code !== 10)) ||
              (node.kind === "literal" && (node.insensitive ? foldAscii(node.code) === foldAscii(code) : node.code === code)) ||
              (node.kind === "set" && (code < 128 ? node.members[code] : node.nonAscii))
            ) {
              push(state.position + 1, current.next);
            }
          }
          break;
        }
        case "sequence": {
          if (ledger.workAllowanceUntilCheckpoint(signal) < node.children.length + 4) return null;
          ledger.chargeWork(node.children.length, signal);
          ledger.charge("allocationUnits", node.children.length * 5, signal);
          if (current.next === null) {
            push(state.position, getSequenceNullNextTask(node));
          } else {
            let next = current.next;
            for (let index = node.children.length - 1; index >= 0; index--) {
              next = { kind: "node", node: node.children[index]!, next };
            }
            push(state.position, next);
          }
          break;
        }
        case "alternative":
          if (ledger.workAllowanceUntilCheckpoint(signal) < node.children.length + 4) return null;
          for (let index = node.children.length - 1; index >= 0; index--) {
            ledger.chargeWork(1, signal);
            ledger.charge("allocationUnits", 5, signal);
            push(state.position, { kind: "node", node: node.children[index]!, next: current.next });
          }
          break;
        case "group":
          ledger.charge("allocationUnits", 5, signal);
          push(state.position, { kind: "node", node: node.child, next: current.next });
          break;
        case "repeat":
          ledger.charge("allocationUnits", 5, signal);
          push(state.position, { kind: "repeat", node, count: 0, previous: -1, next: current.next });
          break;
      }
    }
    if (bestPos >= 0) {
      ledger.charge("allocationUnits", 4, signal);
      ledger.check(signal);
      return { start, end: bestPos };
    }
  }
  return undefined;
}

async function prepareInitialCharacters(root: EreNode, ledger: EreLedger, signal?: AbortSignal): Promise<readonly boolean[] | undefined> {
  // Nullable patterns must still try every cursor, including end of input.
  if (root.nullable) return undefined;
  const cached = initialCharacters.get(root);
  if (cached) return cached;
  // ASCII codes plus the normalized non-ASCII subject value (128). This table
  // belongs to the program's ledger and is reused across rows and cursors.
  ledger.charge("work", 129, signal);
  ledger.charge("allocationUnits", 133, signal);
  { const c = ledger.checkpoint(signal); if (c) await c; }
  const codes = new Array<boolean>(129).fill(false);
  const pending: EreNode[] = [root];
  while (pending.length > 0) {
    ledger.charge("work", 1, signal);
    { const c = ledger.checkpoint(signal); if (c) await c; }
    const node = pending.pop()!;
    switch (node.kind) {
      case "literal": {
        codes[node.code] = true;
        const folded = foldAscii(node.code);
        if (node.insensitive && folded >= 97 && folded <= 122) {
          codes[folded] = codes[folded - 32] = true;
        }
        break;
      }
      case "dot":
      case "set":
        for (let code = 0; code < codes.length; code++) {
          ledger.charge("work", 1, signal);
          { const c = ledger.checkpoint(signal); if (c) await c; }
          if (node.kind === "dot" || node.kind === "set" && (code < 128 ? node.members[code] : node.nonAscii)) codes[code] = true;
        }
        break;
      case "group":
      case "repeat":
        if (node.kind === "repeat" && node.max === 0) break;
        ledger.charge("allocationUnits", 1, signal);
        pending.push(node.child);
        break;
      case "sequence":
      case "alternative":
        for (const child of node.children) {
          ledger.charge("work", 1, signal);
          ledger.charge("allocationUnits", 1, signal);
          { const c = ledger.checkpoint(signal); if (c) await c; }
          pending.push(child);
          if (node.kind === "sequence" && !child.nullable) break;
        }
        break;
    }
  }
  // Anchors only constrain candidates further; the matcher checks them along
  // with capture preference and word boundaries after this conservative filter.
  ledger.check(signal);
  initialCharacters.set(root, Object.freeze(codes));
  return codes;
}

function spanOrder(left: EreSpan | null, right: EreSpan | null): number {
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  const length = left.end - left.start - (right.end - right.start);
  return length === 0 ? right.start - left.start : length;
}

async function historySpans(history: History, ledger: EreLedger, signal?: AbortSignal): Promise<readonly EreSpan[]> {
  ledger.charge("work", history.count, signal);
  ledger.charge("allocationUnits", history.count + 1, signal);
  { const c = ledger.checkpoint(signal); if (c) await c; }
  const spans = new Array<EreSpan>(history.count);
  for (let entry: History | null = history; entry !== null; entry = entry.previous) {
    ledger.charge("work", 1, signal);
    { const c = ledger.checkpoint(signal); if (c) await c; }
    spans[entry.count - 1] = entry.span;
  }
  return spans;
}

async function historyOrder(left: History | null, right: History | null, ledger: EreLedger, signal?: AbortSignal): Promise<number> {
  const leftCount = left?.count ?? 0;
  const rightCount = right?.count ?? 0;
  if (left === null || right === null) return leftCount - rightCount;
  const leftSpans = await historySpans(left, ledger, signal);
  const rightSpans = await historySpans(right, ledger, signal);
  for (let ordinal = 0; ordinal < Math.min(leftCount, rightCount); ordinal++) {
    ledger.charge("work", 1, signal);
    { const c = ledger.checkpoint(signal); if (c) await c; }
    const compared = spanOrder(leftSpans[ordinal]!, rightSpans[ordinal]!);
    if (compared !== 0) return compared;
  }
  return leftCount - rightCount;
}

async function preferred(candidate: State, incumbent: State, ledger: EreLedger, signal?: AbortSignal): Promise<boolean> {
  if (candidate.position !== incumbent.position) return candidate.position > incumbent.position;
  for (let group = 1; group < candidate.captures.length; group++) {
    ledger.charge("work", 1, signal);
    { const c = ledger.checkpoint(signal); if (c) await c; }
    const compared = await historyOrder(candidate.histories[group]!, incumbent.histories[group]!, ledger, signal);
    if (compared !== 0) return compared > 0;
  }
  return false;
}

function resetDescendants(node: EreNode, previous: readonly (EreSpan | null)[], ledger: EreLedger, signal?: AbortSignal): readonly (EreSpan | null)[] | Promise<readonly (EreSpan | null)[]> {
  if (ledger.charge === EreLedger.prototype.charge && ledger.workAllowanceUntilCheckpoint(signal) >= previous.length + 32) {
    ledger.charge("work", previous.length, signal);
    ledger.charge("allocationUnits", previous.length + 3, signal);
    const captures = previous.slice();
    ledger.charge("work", 1, signal);
    if (node.kind === "group") {
      captures[node.index] = null;
      if (!node.child.captured) return captures;
    }
    const pending: EreNode[] = [node];
    while (pending.length > 0 && ledger.workAllowanceUntilCheckpoint(signal) >= 16) {
      ledger.chargeWork(1, signal);
      const current = pending.pop()!;
      if (current.kind === "group") captures[current.index] = null;
      if (current.kind === "group" || current.kind === "repeat") {
        if (current.child.captured) {
          ledger.charge("allocationUnits", 1, signal);
          pending.push(current.child);
        }
      } else if (current.kind === "sequence" || current.kind === "alternative") {
        for (const child of current.children) {
          ledger.chargeWork(1, signal);
          if (child.captured) {
            ledger.charge("allocationUnits", 1, signal);
            pending.push(child);
          }
        }
      }
    }
    if (pending.length === 0) return captures;
  }
  return (async () => {
  ledger.charge("work", previous.length, signal);
  ledger.charge("allocationUnits", previous.length + 3, signal);
  { const c = ledger.checkpoint(signal); if (c) await c; }
  const captures = previous.slice();
  const pending: EreNode[] = [node];
  while (pending.length > 0) {
    ledger.charge("work", 1, signal);
    { const c = ledger.checkpoint(signal); if (c) await c; }
    const current = pending.pop()!;
    if (current.kind === "group") captures[current.index] = null;
    if (current.kind === "group" || current.kind === "repeat") {
      if (current.child.captured) {
        ledger.charge("allocationUnits", 1, signal);
        pending.push(current.child);
      }
    } else if (current.kind === "sequence" || current.kind === "alternative") {
      for (const child of current.children) {
        ledger.charge("work", 1, signal);
        { const c = ledger.checkpoint(signal); if (c) await c; }
        if (child.captured) {
          ledger.charge("allocationUnits", 1, signal);
          pending.push(child);
        }
      }
    }
  }
  return captures;
  })();
}

type EreAtomNode = Extract<EreNode, { kind: "literal" | "set" }>;
type EreChainStep =
  | { readonly kind: "groupOpen"; readonly index: number }
  | { readonly kind: "groupClose"; readonly index: number }
  | { readonly kind: "char"; readonly atom: EreAtomNode }
  | { readonly kind: "repeat"; readonly atom: EreAtomNode; readonly min: number };

interface CompiledEreLinearChain {
  readonly anchoredStart: boolean;
  readonly anchoredEnd: boolean;
  readonly steps: readonly EreChainStep[];
  readonly firstAtom: EreAtomNode | undefined;
}

const ereLinearChainCache = /* @__PURE__ */ new WeakMap<EreNode, CompiledEreLinearChain | null>();

function ereAtomMatchesCode(atom: EreAtomNode, code: number): boolean {
  if (atom.kind === "literal") {
    return atom.insensitive ? foldAscii(atom.code) === foldAscii(code) : atom.code === code;
  }
  return code < 128 ? atom.members[code]! : atom.nonAscii;
}

function ereAtomsDisjoint(a: EreAtomNode, b: EreAtomNode): boolean {
  for (let code = 0; code <= 128; code++) {
    if (ereAtomMatchesCode(a, code) && ereAtomMatchesCode(b, code)) return false;
  }
  return true;
}

/** Synchronous speculation must stop before it owes a cooperative checkpoint. */
function admitSynchronousWork(ledger: EreLedger, amount: number, signal?: AbortSignal): boolean {
  if (ledger.workAllowanceUntilCheckpoint(signal) < amount) {
    ledger.check(signal);
    return false;
  }
  ledger.chargeWork(amount, signal);
  return true;
}

/** Complete an admitted operation across quanta without replaying its caller. */
function* chargeLinearWork(ledger: EreLedger, amount: number, signal?: AbortSignal): Generator<void> {
  while (amount > 0) {
    const allowance = ledger.workAllowanceUntilCheckpoint(signal);
    if (allowance === 0) {
      // A resource ceiling is an error, not a reason to keep yielding.
      if (ledger.usage.work >= ledger.limits.work) ledger.chargeWork(1, signal);
      yield;
      continue;
    }
    const charged = Math.min(amount, allowance);
    ledger.chargeWork(charged, signal);
    amount -= charged;
    if (amount > 0) yield;
  }
}

function* compileEreLinearChain(root: EreNode, ledger: EreLedger, signal?: AbortSignal): Generator<void, CompiledEreLinearChain | null> {
  if (!admitSynchronousWork(ledger, 1, signal)) yield* chargeLinearWork(ledger, 1, signal);
  const cached = ereLinearChainCache.get(root);
  if (cached !== undefined) return cached;
  ledger.charge("allocationUnits", 3, signal);
  let anchoredStart = false;
  let anchoredEnd = false;
  let seenConsuming = false;
  const steps: EreChainStep[] = [];
  const pending: (EreNode | Extract<EreChainStep, { kind: "groupClose" }>)[] = [root];
  let supported = true;
  while (pending.length > 0 && supported) {
    if (!admitSynchronousWork(ledger, 1, signal)) yield* chargeLinearWork(ledger, 1, signal);
    const node = pending.pop()!;
    switch (node.kind) {
      case "start":
        if (seenConsuming || steps.length > 0) { supported = false; break; }
        anchoredStart = true;
        break;
      case "end":
        anchoredEnd = true;
        break;
      case "sequence":
        if (!admitSynchronousWork(ledger, node.children.length, signal)) yield* chargeLinearWork(ledger, node.children.length, signal);
        ledger.charge("allocationUnits", node.children.length, signal);
        for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]!);
        break;
      case "group":
        if (anchoredEnd) { supported = false; break; }
        ledger.charge("allocationUnits", 7, signal);
        steps.push({ kind: "groupOpen", index: node.index });
        pending.push({ kind: "groupClose", index: node.index }, node.child);
        break;
      case "groupClose":
        ledger.charge("allocationUnits", 1, signal);
        steps.push(node);
        break;
      case "literal":
      case "set":
        if (anchoredEnd) { supported = false; break; }
        seenConsuming = true;
        ledger.charge("allocationUnits", 3, signal);
        steps.push({ kind: "char", atom: node });
        break;
      case "repeat":
        if (anchoredEnd || node.min < 1 || node.max !== Infinity ||
          node.child.kind !== "literal" && node.child.kind !== "set") { supported = false; break; }
        seenConsuming = true;
        ledger.charge("allocationUnits", 4, signal);
        steps.push({ kind: "repeat", atom: node.child, min: node.min });
        break;
      default:
        supported = false;
    }
  }
  let firstAtom: EreAtomNode | undefined;
  // A reverse pass finds each repeat's next consuming atom without rescanning
  // intervening capture steps for every repeat.
  for (let i = steps.length - 1; supported && i >= 0; i--) {
    if (!admitSynchronousWork(ledger, 1, signal)) yield* chargeLinearWork(ledger, 1, signal);
    const step = steps[i]!;
    if (step.kind !== "char" && step.kind !== "repeat") continue;
    if (step.kind === "repeat" && firstAtom) {
      if (!admitSynchronousWork(ledger, 129, signal)) yield* chargeLinearWork(ledger, 129, signal);
      if (!ereAtomsDisjoint(step.atom, firstAtom)) supported = false;
    }
    firstAtom = step.atom;
  }
  if (!admitSynchronousWork(ledger, 1, signal)) yield* chargeLinearWork(ledger, 1, signal);
  ledger.charge("allocationUnits", supported && seenConsuming ? 6 : 2, signal);
  if (!supported || !seenConsuming) {
    ereLinearChainCache.set(root, null);
    return null;
  }
  const compiled: CompiledEreLinearChain = { anchoredStart, anchoredEnd, steps, firstAtom };
  ereLinearChainCache.set(root, compiled);
  return compiled;
}

function* matchEreLinearChain(
  program: EreProgram,
  root: EreNode,
  subject: string,
  ledger: EreLedger,
  signal?: AbortSignal,
): Generator<void, EreResult | undefined> {
  const chain = yield* compileEreLinearChain(root, ledger, signal);
  if (!chain) return undefined;
  const width = program.groups + 1;
  if (!admitSynchronousWork(ledger, width * 2, signal)) yield* chargeLinearWork(ledger, width * 2, signal);
  ledger.charge("allocationUnits", width * 2 + 2, signal);
  const groupStarts = new Int32Array(width);
  const groupEnds = new Int32Array(width);
  const maxStart = chain.anchoredStart ? 0 : subject.length;
  const steps = chain.steps;
  const stepsLen = steps.length;
  for (let start = 0; start <= maxStart; start++) {
    if (!admitSynchronousWork(ledger, 1, signal)) yield* chargeLinearWork(ledger, 1, signal);
    ledger.charge("states", 1, signal);
    if (chain.firstAtom) {
      if (start >= subject.length) break;
      if (!ereAtomMatchesCode(chain.firstAtom, subject.charCodeAt(start))) {
        continue;
      }
    }
    if (!admitSynchronousWork(ledger, width * 2, signal)) yield* chargeLinearWork(ledger, width * 2, signal);
    groupStarts.fill(-1);
    groupEnds.fill(-1);
    let pos = start;
    let ok = true;
    for (let s = 0; s < stepsLen; s++) {
      if (!admitSynchronousWork(ledger, 1, signal)) yield* chargeLinearWork(ledger, 1, signal);
      ledger.charge("states", 1, signal);
      const step = steps[s]!;
      if (step.kind === "groupOpen") {
        groupStarts[step.index] = pos;
      } else if (step.kind === "groupClose") {
        groupEnds[step.index] = pos;
      } else if (step.kind === "char") {
        if (pos >= subject.length || !ereAtomMatchesCode(step.atom, subject.charCodeAt(pos))) {
          ok = false;
          break;
        }
        pos++;
      } else {
        let count = 0;
        while (pos < subject.length) {
          if (!admitSynchronousWork(ledger, 1, signal)) yield* chargeLinearWork(ledger, 1, signal);
          ledger.charge("states", 1, signal);
          if (!ereAtomMatchesCode(step.atom, subject.charCodeAt(pos))) break;
          pos++;
          count++;
        }
        if (count < step.min) {
          ok = false;
          break;
        }
      }
    }
    if (!ok || (chain.anchoredEnd && pos !== subject.length)) continue;
    if (!admitSynchronousWork(ledger, width, signal)) yield* chargeLinearWork(ledger, width, signal);
    let bytes = pos - start;
    for (let g = 1; g < width; g++) {
      if (groupStarts[g]! >= 0 && groupEnds[g]! >= groupStarts[g]!) {
        bytes += groupEnds[g]! - groupStarts[g]!;
      }
    }
    if (!admitSynchronousWork(ledger, width * 3 + bytes, signal)) yield* chargeLinearWork(ledger, width * 3 + bytes, signal);
    ledger.charge("captureSlots", width, signal);
    ledger.charge("captureBytes", bytes, signal);
    // Two result arrays, one span per capture, copied strings and the result.
    ledger.charge("allocationUnits", width * 4 + bytes + 6, signal);
    const captures = new Array<EreSpan | null>(width);
    const values = new Array<string>(width);
    captures[0] = /* @__PURE__ */ Object.freeze({ start, end: pos });
    values[0] = subject.slice(start, pos);
    for (let g = 1; g < width; g++) {
      const gs = groupStarts[g]!;
      const ge = groupEnds[g]!;
      if (gs >= 0 && ge >= gs) {
        captures[g] = /* @__PURE__ */ Object.freeze({ start: gs, end: ge });
        values[g] = subject.slice(gs, ge);
      } else {
        captures[g] = null;
        values[g] = "";
      }
    }
    ledger.check(signal);
    return Object.freeze({ matched: true, captures: Object.freeze(captures), values: Object.freeze(values) });
  }
  if (!admitSynchronousWork(ledger, 1, signal)) yield* chargeLinearWork(ledger, 1, signal);
  ledger.charge("allocationUnits", 4, signal);
  ledger.check(signal);
  return Object.freeze({ matched: false, captures: Object.freeze([] as const), values: Object.freeze([] as const) });
}

interface LinearContinuation {
  readonly program: EreProgram;
  readonly subject: string;
  readonly signal: AbortSignal | undefined;
  readonly iterator: Generator<void, EreResult | undefined>;
}

// A declined synchronous probe hands its exact cursor to the async entrypoint.
const linearContinuations = /* @__PURE__ */ new WeakMap<EreLedger, LinearContinuation>();

export function tryMatchEreSync(program: EreProgram, subject: string, ledger: EreLedger, signal?: AbortSignal): EreResult | undefined {
  ledger.check(signal);
  const root = resolveEreProgram(program, ledger);
  const pending = linearContinuations.get(ledger);
  if (pending?.program === program && pending.subject === subject && pending.signal === signal) return undefined;
  linearContinuations.delete(ledger);
  if (subject.length > ledger.limits.subjectBytes || ledger.workAllowanceUntilCheckpoint(signal) < subject.length + 16) return undefined;
  ledger.admitInput("subjectBytes", subject.length, signal);
  const adm = admitAscii(subject, ledger, signal);
  if (adm) return undefined;
  const iterator = matchEreLinearChain(program, root, subject, ledger, signal);
  const next = iterator.next();
  if (next.done) return next.value;
  linearContinuations.set(ledger, { program, subject, signal, iterator });
  return undefined;
}

export async function matchEre(program: EreProgram, subject: string, ledger: EreLedger, signal?: AbortSignal): Promise<EreResult> {
  ledger.check(signal);
  const root = resolveEreProgram(program, ledger);
  const pending = linearContinuations.get(ledger);
  linearContinuations.delete(ledger);
  let iterator: Generator<void, EreResult | undefined>;
  if (pending?.program === program && pending.subject === subject && pending.signal === signal) {
    iterator = pending.iterator;
    const checkpoint = ledger.checkpoint(signal);
    if (checkpoint) await checkpoint;
  } else {
    ledger.admitInput("subjectBytes", subject.length, signal);
    const adm = admitAscii(subject, ledger, signal);
    if (adm) await adm;
    iterator = matchEreLinearChain(program, root, subject, ledger, signal);
  }
  for (;;) {
    const next = iterator.next();
    if (next.done) return next.value ?? runMatcher(program, subject, ledger, signal, 0, true);
    const checkpoint = ledger.checkpoint(signal);
    if (checkpoint) await checkpoint;
  }
}

/** Owns one validated immutable subject; cursor searches preserve original anchors. */
export async function createEreSpanMatcher(program: EreProgram, subject: string, ledger: EreLedger, signal?: AbortSignal): Promise<(start: number) => Promise<EreSpan | undefined>> {
  ledger.check(signal);
  const root = resolveEreProgram(program, ledger);
  ledger.admitInput("subjectBytes", subject.length, signal);
  await admitAscii(subject, ledger, signal);
  await prepareInitialCharacters(root, ledger, signal);
  ledger.charge("allocationUnits", 2, signal);
  return async start => {
    if (!Number.isSafeInteger(start) || start < 0 || start > subject.length) throw new RangeError("Invalid ERE search cursor");
    return runMatcher(program, subject, ledger, signal, start, false);
  };
}

/** Owns validated UTF-8, using byte positions for C-locale word matching. */
export async function prepareUtf8EreSubject(bytes: Uint8Array, ledger: EreLedger, signal?: AbortSignal, leftmostFirst = false, word = false): Promise<(program: EreProgram) => (start: number) => Promise<EreSpan | undefined>> {
  ledger.check(signal);
  ledger.admitInput("subjectBytes", bytes.length, signal);
  // Logical allocation units per byte: copy 1, offset storage 8, character
  // slot 1, normalized string 1. Both profiles use at most one slot per byte.
  ledger.charge("allocationUnits", bytes.length * 11 + 16, signal);
  ledger.charge("work", bytes.length, signal);
  const owned = new Uint8Array(bytes);
  await validateUtf8(owned, ledger, signal);
  const characters: string[] = [];
  const offsets: number[] = [];
  for (let offset = 0; offset < owned.length;) {
    const first = owned[offset]!;
    const width = word || first < 0x80 ? 1 : first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4;
    ledger.charge("work", width, signal);
    { const c = ledger.checkpoint(signal); if (c) await c; }
    offsets.push(offset);
    // ASCII patterns cannot distinguish non-ASCII byte/scalar values. U+0080 is
    // private matcher input, never reconstructed output or user-visible text.
    characters.push(String.fromCharCode(first < 0x80 ? first : 128));
    offset += width;
  }
  offsets.push(owned.length);
  ledger.charge("work", characters.length, signal);
  { const c = ledger.checkpoint(signal); if (c) await c; }
  const subject = characters.join("");
  return program => {
    resolveEreProgram(program, ledger);
    ledger.charge("allocationUnits", 2, signal);
    return async start => {
      if (!Number.isSafeInteger(start) || start < 0 || start > owned.length) throw new RangeError("Invalid UTF-8 ERE search cursor");
      let lower = 0, upper = offsets.length - 1;
      while (lower < upper) {
        ledger.charge("work", 1, signal);
        { const c = ledger.checkpoint(signal); if (c) await c; }
        const middle = Math.floor((lower + upper) / 2);
        if (offsets[middle]! < start) lower = middle + 1;
        else upper = middle;
      }
      if (offsets[lower] !== start) throw new RangeError("UTF-8 ERE cursor must be a scalar boundary");
      const span = await runMatcher(program, subject, ledger, signal, lower, false, leftmostFirst, word);
      if (!span) return undefined;
      ledger.charge("allocationUnits", 2, signal);
      return Object.freeze({ start: offsets[span.start]!, end: offsets[span.end]! });
    };
  };
}

async function runMatcher(program: EreProgram, subject: string, ledger: EreLedger, signal: AbortSignal | undefined, from: number, materialize: true, leftmostFirst?: boolean, word?: boolean): Promise<EreResult>;
async function runMatcher(program: EreProgram, subject: string, ledger: EreLedger, signal: AbortSignal | undefined, from: number, materialize: false, leftmostFirst?: boolean, word?: boolean): Promise<EreSpan | undefined>;
async function runMatcher(program: EreProgram, subject: string, ledger: EreLedger, signal: AbortSignal | undefined, from: number, materialize: boolean, leftmostFirst = false, word = false): Promise<EreResult | EreSpan | undefined> {
  const root = resolveEreProgram(program, ledger);
  const initial = await prepareInitialCharacters(root, ledger, signal);
  const width = program.groups + 1;
  ledger.charge("work", width * 2, signal);
  ledger.charge("allocationUnits", width * 2 + 1, signal);
  { const c = ledger.checkpoint(signal); if (c) await c; }
  const emptyCaptures: readonly (EreSpan | null)[] = /* @__PURE__ */ Object.freeze(new Array<EreSpan | null>(width).fill(null));
  const emptyHistories: readonly (History | null)[] = /* @__PURE__ */ Object.freeze(new Array<History | null>(width).fill(null));
  const pending: State[] = [];
  // Capture histories affect precedence; only group-free states are equivalent
  // solely by their position and remaining tasks.
  const seen = program.groups === 0 ? new Set<string>() : undefined;
  const nodeIds = new Map<EreNode, number>();
  const task = (create: () => Task): Task => {
    ledger.charge("allocationUnits", 5, signal);
    return create();
  };
  const push = (position: number, next: Task | null, captures: readonly (EreSpan | null)[], histories: readonly (History | null)[]): void => {
    if (seen) {
      const key = spanStateKey(position, next, nodeIds);
      ledger.charge("work", key.length, signal);
      ledger.charge("allocationUnits", key.length + 2, signal);
      if (seen.has(key)) return;
      seen.add(key);
    }
    ledger.charge("states", 1, signal);
    ledger.charge("allocationUnits", 5, signal);
    pending.push({ position, task: next, captures, histories });
  };
  for (let start = from; start <= subject.length; start++) {
    seen?.clear();
    if (initial) {
      ledger.charge("work", 1, signal);
      const pendingCheck = ledger.checkpoint(signal);
      if (pendingCheck) await pendingCheck;
      if (!initial[subject.charCodeAt(start)]) continue;
    }
    if (word) {
      ledger.charge("work", 1, signal);
      const pendingCheck = ledger.checkpoint(signal);
      if (pendingCheck) await pendingCheck;
      if (isAsciiWord(subject.charCodeAt(start - 1))) continue;
    }
    push(start, task(() => ({ kind: "node", node: root, next: null })), emptyCaptures, emptyHistories);
    let best: State | undefined;
    while (pending.length > 0) {
      ledger.charge("work", 1, signal);
      const pendingCheck = ledger.checkpoint(signal);
      if (pendingCheck) await pendingCheck;
      const state = pending.pop()!;
      const current = state.task;
      if (current === null) {
        // Reject invalid ends before choosing the longest match, so shorter
        // alternatives and repetition endpoints remain eligible at this start.
        if (word && isAsciiWord(subject.charCodeAt(state.position))) continue;
        if (leftmostFirst) { best = state; break; }
        if (!best || (state.position !== best.position ? state.position > best.position : await preferred(state, best, ledger, signal))) best = state;
        continue;
      }
      if (current.kind === "close") {
        ledger.charge("work", width * 2, signal);
        ledger.charge("allocationUnits", width * 2 + 6, signal);
        { const c = ledger.checkpoint(signal); if (c) await c; }
        const span = /* @__PURE__ */ Object.freeze({ start: current.start, end: state.position });
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
          if (state.position < subject.length && (node.kind === "dot" && (!leftmostFirst || code !== 10) || node.kind === "literal" && (node.insensitive ? foldAscii(node.code) === foldAscii(code) : node.code === code) || node.kind === "set" && (code < 128 ? node.members[code] : node.nonAscii))) {
            push(state.position + 1, current.next, state.captures, state.histories);
          }
          break;
        }
        case "sequence": {
          let next = current.next;
          for (let index = node.children.length - 1; index >= 0; index--) {
            ledger.charge("work", 1, signal);
            { const c = ledger.checkpoint(signal); if (c) await c; }
            const following = next;
            next = task(() => ({ kind: "node", node: node.children[index]!, next: following }));
          }
          push(state.position, next, state.captures, state.histories);
          break;
        }
        case "alternative":
          for (let index = node.children.length - 1; index >= 0; index--) {
            ledger.charge("work", 1, signal);
            { const c = ledger.checkpoint(signal); if (c) await c; }
            push(state.position, task(() => ({ kind: "node", node: node.children[index]!, next: current.next })), state.captures, state.histories);
          }
          break;
        case "group": {
          let captures = state.captures;
          if (node.child.captured) {
            const rd = resetDescendants(node.child, state.captures, ledger, signal);
            captures = rd instanceof Promise ? await rd : rd;
          }
          const close = task(() => ({ kind: "close", group: node.index, start: state.position, next: current.next }));
          push(state.position, task(() => ({ kind: "node", node: node.child, next: close })), captures, state.histories);
          break;
        }
        case "repeat":
          push(state.position, task(() => ({ kind: "repeat", node, count: 0, previous: -1, next: current.next })), state.captures, state.histories);
          break;
      }
    }
    if (best) {
      if (!materialize) {
        ledger.charge("allocationUnits", 2, signal);
        ledger.check(signal);
        return Object.freeze({ start, end: best.position });
      }
      ledger.charge("captureSlots", width, signal);
      let bytes = best.position - start;
      for (let group = 1; group < width; group++) {
        ledger.charge("work", 1, signal);
        { const c = ledger.checkpoint(signal); if (c) await c; }
        const span = best.captures[group];
        if (span) bytes += span.end - span.start;
      }
      ledger.charge("captureBytes", bytes, signal);
      ledger.charge("work", width * 2 + bytes, signal);
      ledger.charge("allocationUnits", width * 2 + bytes + 4, signal);
      { const c = ledger.checkpoint(signal); if (c) await c; }
      const captures = best.captures.slice();
      captures[0] = /* @__PURE__ */ Object.freeze({ start, end: best.position });
      const values = new Array<string>(width);
      for (let group = 0; group < width; group++) {
        ledger.charge("work", 1, signal);
        { const c = ledger.checkpoint(signal); if (c) await c; }
        const span = captures[group]!;
        values[group] = span === null ? "" : subject.slice(span.start, span.end);
      }
      ledger.check(signal);
      return Object.freeze({ matched: true, captures: Object.freeze(captures), values: Object.freeze(values) });
    }
  }
  ledger.check(signal);
  if (!materialize) return undefined;
  ledger.charge("allocationUnits", 3, signal);
  return Object.freeze({ matched: false, captures: Object.freeze([] as const), values: Object.freeze([] as const) });
}
