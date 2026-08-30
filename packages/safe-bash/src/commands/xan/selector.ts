import { Budget, XanError } from "./budget.js";

interface Endpoint { name: string; bytes: Uint8Array; index?: bigint; occurrence?: bigint }
type Clause = { kind: "all" } | { kind: "prefix" | "suffix"; text: string; bytes: Uint8Array } | { kind: "one"; endpoint: Endpoint } | { kind: "range"; start?: Endpoint; end?: Endpoint };
export interface Selection { complement: boolean; clauses: Clause[] }
const minimum = -(1n << 63n);
const maximum = (1n << 63n) - 1n;
function signed(text: string): bigint | undefined {
  if (!/^[+-]?[0-9]+$/u.test(text)) return undefined;
  const digits = text.replace(/^[+-]?0*/u, "");
  if (digits.length > 19) return undefined;
  const value = BigInt(text);
  return value >= minimum && value <= maximum ? value : undefined;
}
export async function parseSelection(text: string, budget: Budget): Promise<Selection> {
  budget.bound("maxSelectorBytes", await budget.textSize(text));
  budget.bound("maxSelectorDepth", 1);
  let offset = 0;
  const node = (): void => { budget.add("maxSelectorNodes", 1); budget.hold(32); };
  const invalid = (): never => { throw new XanError("unsupported in bounded CSV profile: selector syntax"); };
  const complement = text.startsWith("!");
  if (complement) { node(); offset++; }
  const clauses: Clause[] = [];
  if (offset === text.length) { budget.bound("maxSelectorDepth", 2); node(); clauses.push({ kind: "all" }); return { complement, clauses }; }
  const endpoint = async (): Promise<Endpoint> => {
    node();
    const begin = offset;
    let name: string;
    if (text[offset] === '"') {
      offset++;
      const start = offset;
      let closed = false;
      while (offset < text.length) {
        budget.work();
        if (text[offset] === '"') {
          if (text[offset + 1] === '"') { offset += 2; continue; }
          budget.hold((offset - start) * 2); name = text.slice(start, offset++); closed = true; break;
        }
        offset++;
        if ((offset & 1023) === 0) await budget.checkpoint();
      }
      if (!closed) throw new XanError('Unclosed quote, missing closing ".');
      if (offset < text.length && !["[", ":", ","].includes(text[offset]!)) invalid();
    } else {
      while (offset < text.length && ![",", ":", "["].includes(text[offset]!)) { budget.work(); offset++; if ((offset & 1023) === 0) await budget.checkpoint(); }
      budget.hold((offset - begin) * 2); name = text.slice(begin, offset);
      if (!name && text[offset] !== "[") invalid();
    }
    let occurrence: bigint | undefined;
    if (text[offset] === "[") {
      node();
      const start = ++offset;
      while (offset < text.length && text[offset] !== "]") { budget.work(); offset++; if ((offset & 1023) === 0) await budget.checkpoint(); }
      if (offset === text.length) throw new XanError("Unclosed index bracket, missing closing ].");
      budget.hold((offset - start) * 2);
      occurrence = signed(text.slice(start, offset));
      budget.release((offset - start) * 2); offset++;
      if (occurrence === undefined) throw new XanError("invalid selector occurrence: expected signed i64");
      if (offset < text.length && ![":", ","].includes(text[offset]!)) invalid();
    }
    const index = occurrence === undefined ? signed(name!) : undefined;
    return { name: name!, bytes: await budget.encode(name!), ...(index !== undefined ? { index } : {}), ...(occurrence !== undefined ? { occurrence } : {}) };
  };
  while (offset < text.length) {
    budget.bound("maxSelectorDepth", 2); node();
    if (text[offset] === ",") invalid();
    if (text[offset] === "*") {
      const begin = ++offset;
      while (offset < text.length && ![",", ":", "["].includes(text[offset]!)) { budget.work(); offset++; if ((offset & 1023) === 0) await budget.checkpoint(); }
      if (offset < text.length && text[offset] !== ",") invalid();
      if (offset === begin) clauses.push({ kind: "all" });
      else { budget.hold((offset - begin) * 2); const suffix = text.slice(begin, offset); clauses.push({ kind: "suffix", text: suffix, bytes: await budget.encode(suffix) }); }
    } else {
      const start = text[offset] === ":" ? undefined : await endpoint();
      if (start && start.index === undefined && start.occurrence === undefined && start.name.endsWith("*")) {
        if (offset < text.length && text[offset] !== ",") invalid();
        budget.hold((start.name.length - 1) * 2);
        const prefix = start.name.slice(0, -1);
        clauses.push({ kind: "prefix", text: prefix, bytes: await budget.encode(prefix) });
      } else if (text[offset] === ":") {
        offset++;
        const end = offset === text.length || text[offset] === "," ? undefined : await endpoint();
        if (offset < text.length && text[offset] !== ",") invalid();
        clauses.push({ kind: "range", ...(start ? { start } : {}), ...(end ? { end } : {}) });
      } else if (start) clauses.push({ kind: "one", endpoint: start });
      else invalid();
    }
    if (offset === text.length) break;
    if (text[offset] !== ",") invalid();
    offset++;
  }
  return { complement, clauses };
}
async function matches(cell: Uint8Array, needle: Uint8Array, kind: "one" | "prefix" | "suffix", budget: Budget): Promise<boolean> {
  if (kind === "one" ? cell.length !== needle.length : cell.length < needle.length) return false;
  const start = kind === "suffix" ? cell.length - needle.length : 0;
  for (let offset = 0; offset < needle.length; offset++) {
    budget.work();
    if (cell[start + offset] !== needle[offset]) return false;
    if ((offset & 1023) === 0) await budget.checkpoint();
  }
  return true;
}
export async function resolveSelection(selection: Selection, cells: readonly Uint8Array[], noHeaders: boolean, budget: Budget): Promise<number[]> {
  const positions: number[] = [];
  const append = (index: number): void => { budget.bound("maxSelectedColumns", positions.length + 1); budget.hold(8); budget.work(); positions.push(index); };
  const resolve = async (endpoint: Endpoint): Promise<number> => {
    if (endpoint.index !== undefined) {
      const resolved = endpoint.index < 0n ? BigInt(cells.length) + endpoint.index : endpoint.index;
      if (resolved < 0n || resolved >= BigInt(cells.length)) throw new XanError(`Selector index ${endpoint.index} is out of bounds. Valid indices are 0 to ${cells.length}.`);
      return Number(resolved);
    }
    if (noHeaders) throw new XanError("named selector requires headers (not -n)");
    let count = 0;
    let first = -1;
    const occurrence = endpoint.occurrence ?? 0n;
    for (let index = 0; index < cells.length; index++) {
      budget.work();
      if (await matches(cells[index]!, endpoint.bytes, "one", budget)) {
        if (first < 0) first = index;
        if (occurrence >= 0n && BigInt(count) === occurrence) return index;
        count++;
      }
    }
    if (first < 0) throw new XanError(`Selector name '${endpoint.name}' does not exist as a named header in the given CSV data.`);
    const target = BigInt(count) + occurrence;
    if (occurrence >= 0n || target < 0n) throw new XanError(`Selector occurrence ${occurrence} for '${endpoint.name}' is out of bounds.`);
    count = 0;
    for (let index = 0; index < cells.length; index++) if (await matches(cells[index]!, endpoint.bytes, "one", budget) && BigInt(count++) === target) return index;
    throw new XanError("selector occurrence resolution failed");
  };
  for (const clause of selection.clauses) {
    if (clause.kind === "all") { for (let index = 0; index < cells.length; index++) { append(index); if ((index & 1023) === 0) await budget.checkpoint(); } }
    else if (clause.kind === "one") append(await resolve(clause.endpoint));
    else if (clause.kind === "range") {
      if (!cells.length && !clause.start && !clause.end) continue;
      const start = clause.start ? await resolve(clause.start) : 0;
      const end = clause.end ? await resolve(clause.end) : cells.length - 1;
      const direction = start <= end ? 1 : -1;
      for (let index = start; ; index += direction) { append(index); if (index === end) break; if ((positions.length & 1023) === 0) await budget.checkpoint(); }
    } else {
      if (noHeaders) throw new XanError("named selector requires headers (not -n)");
      const before = positions.length;
      for (let index = 0; index < cells.length; index++) {
        budget.work();
        if (await matches(cells[index]!, clause.bytes, clause.kind, budget)) append(index);
      }
      if (positions.length === before) throw new XanError(`${clause.kind === "prefix" ? "Prefix" : "Suffix"} '${clause.text}' selected nothing.`);
    }
  }
  if (!selection.complement) return positions;
  budget.hold(cells.length);
  const seen = new Uint8Array(cells.length);
  for (const index of positions) { budget.work(); seen[index] = 1; }
  budget.release(positions.length * 8); positions.length = 0;
  for (let index = 0; index < cells.length; index++) { budget.work(); if (!seen[index]) append(index); if ((index & 1023) === 0) await budget.checkpoint(); }
  budget.release(seen.length);
  return positions;
}
