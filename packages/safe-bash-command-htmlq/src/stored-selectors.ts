import { IntegerTable, type PagedStorage } from "@poe-code/safe-fs/storage";
import type { TextStore } from "safe-bash-command-html-to-markdown/stored-text";
import { HtmlBudget, type HtmlOptions } from "./contracts.js";
import { DocumentStore, StoredSequence, type StoredHtmlNode } from "./document-store.js";
import { SelectorParser, cssSpace, type Program, type Test } from "./selectors.js";

function lower(value: string): string {
  let result = "";
  for (const c of value) result += c >= "A" && c <= "Z" ? String.fromCharCode(c.charCodeAt(0) + 32) : c;
  return result;
}

/** Comparisons retain only rope windows and the caller-supplied selector text. */
export class StoredQueries {
  private readonly pending: StoredSequence;
  private revision = -1;
  private ranks: IntegerTable;
  private rankParents: IntegerTable;
  constructor(readonly tree: DocumentStore, readonly text: TextStore, private readonly storage: PagedStorage, readonly budget: HtmlBudget) {
    this.pending = new StoredSequence(storage);
    this.ranks = new IntegerTable(storage, 64);
    this.rankParents = new IntegerTable(storage, 64);
  }

  async literal(root: number, expected: string, insensitive = false, prefix = false): Promise<boolean> {
    const length = (await this.text.info(root)).length;
    this.budget.charge("work", length + expected.length);
    if (prefix ? length < expected.length : length !== expected.length) return false;
    let at = 0;
    if (insensitive) expected = lower(expected);
    for await (const original of this.text.chunks(root)) {
      const chunk = insensitive ? lower(original) : original;
      for (let i = 0; i < chunk.length && at < expected.length; i++, at++) if (chunk[i] !== expected[at]) return false;
      if (at === expected.length) return true;
    }
    return at === expected.length;
  }

  async equal(left: number, right: number): Promise<boolean> {
    if (left === right) return true;
    if ((await this.text.info(left)).length !== (await this.text.info(right)).length) return false;
    const a = this.text.chunks(left), b = this.text.chunks(right);
    let x = "", y = "", ax = 0, by = 0;
    try {
      for (;;) {
        if (ax === x.length) { x = (await a.next()).value ?? ""; ax = 0; }
        if (by === y.length) { y = (await b.next()).value ?? ""; by = 0; }
        if (!x || !y) return x === y;
        const length = Math.min(x.length - ax, y.length - by);
        this.budget.charge("work", length);
        if (x.slice(ax, ax + length) !== y.slice(by, by + length)) return false;
        ax += length; by += length;
      }
    } finally { await a.return(undefined); await b.return(undefined); }
  }

  async attribute(node: StoredHtmlNode, name: string): Promise<number | undefined> {
    this.budget.charge("work", name.length);
    this.budget.charge("retainedBytes", name.length * 2);
    const expected = node.namespace === "html" ? lower(name) : name;
    for await (const a of this.tree.attributes(node.id)) {
      this.budget.charge("work", 1);
      if (a.namespace === "none" && await this.literal(a.name, expected)) return a.value;
    }
    return undefined;
  }

  async word(root: number, expected: string, insensitive = false): Promise<boolean> {
    if (!expected) return false;
    for (const c of expected) if (cssSpace(c)) return false;
    if (insensitive) expected = lower(expected);
    let at = 0, matching = true;
    for await (const original of this.text.chunks(root)) {
      const chunk = insensitive ? lower(original) : original;
      this.budget.charge("work", chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i]!;
        if (cssSpace(c)) {
          if (matching && at === expected.length) return true;
          at = 0; matching = true;
        } else {
          if (c !== expected[at]) matching = false;
          at++;
        }
      }
    }
    return matching && at === expected.length;
  }

  private async contains(root: number, expected: string, insensitive: boolean): Promise<boolean> {
    if (!expected) return false;
    if (insensitive) expected = lower(expected);
    let tail = "";
    for await (const original of this.text.chunks(root)) {
      const chunk = tail + (insensitive ? lower(original) : original);
      this.budget.charge("work", chunk.length);
      if (chunk.includes(expected)) return true;
      tail = expected.length === 1 ? "" : chunk.slice(-(expected.length - 1));
    }
    return false;
  }

  /** Build sibling ordinals once per parent; type totals are shared stored
   * counters. Mutation invalidates indexes, while both resident caches stay fixed. */
  private async rank(node: StoredHtmlNode, typed: boolean): Promise<readonly [number, number]> {
    if (!node.parent) return [0, 0];
    if (this.revision !== this.tree.revision) {
      this.ranks = new IntegerTable(this.storage, 64);
      this.rankParents = new IntegerTable(this.storage, 64);
      this.revision = this.tree.revision;
    }
    const flag = BigInt(Number(typed)), parentKey = BigInt(node.parent) * 2n + flag;
    let total = await this.rankParents.get(parentKey);
    if (total === undefined) {
      let count = 0;
      const families = new IntegerTable(this.storage, 64);
      for await (const id of this.tree.children(node.parent)) {
        this.budget.charge("work", 1);
        const child = await this.tree.read(id);
        if (child.kind !== "element") continue;
        count++;
        let position = count;
        if (typed) {
          let hash = 2166136261;
          for await (const chunk of this.text.chunks(child.name)) {
            this.budget.charge("work", chunk.length);
            for (let i = 0; i < chunk.length; i++) hash = Math.imul(hash ^ chunk.charCodeAt(i), 16777619) >>> 0;
          }
          const key = BigInt(hash) * 4n + BigInt(child.namespace === "html" ? 0 : child.namespace === "svg" ? 1 : 2);
          const first = Number(await families.get(key) ?? 0n);
          let counter = first, ordinal = 1;
          while (counter) {
            const bytes = await this.storage.read(counter, 24), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            if (await this.equal(child.name, view.getFloat64(8, true))) { ordinal = view.getFloat64(16, true) + 1; break; }
            counter = view.getFloat64(0, true);
          }
          if (!counter) {
            const bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
            view.setFloat64(0, first, true); view.setFloat64(8, child.name, true); view.setFloat64(16, 1, true);
            counter = await this.storage.append(bytes); await families.set(key, BigInt(counter));
          } else {
            const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, ordinal, true);
            await this.storage.write(counter + 16, bytes);
          }
          const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
          view.setFloat64(0, ordinal, true); view.setFloat64(8, counter + 16, true);
          position = await this.storage.append(bytes);
        }
        this.budget.charge("retainedBytes", typed ? 48 : 16);
        await this.ranks.set(BigInt(id) * 2n + flag, BigInt(position));
      }
      total = BigInt(count); await this.rankParents.set(parentKey, total);
    }
    const position = await this.ranks.get(BigInt(node.id) * 2n + flag);
    if (position === undefined) return [0, 0];
    if (!typed) return [Number(position), Number(total)];
    const bytes = await this.storage.read(Number(position), 16), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = await this.storage.read(view.getFloat64(8, true), 8);
    return [view.getFloat64(0, true), new DataView(count.buffer, count.byteOffset, count.byteLength).getFloat64(0, true)];
  }

  private async previous(id: number): Promise<number> {
    let n = (await this.tree.read(id)).previous;
    while (n) {
      const node = await this.tree.read(n);
      if (node.kind === "element") return n;
      this.budget.charge("work", 1); n = node.previous;
    }
    return 0;
  }

  private async test(node: StoredHtmlNode, test: Test): Promise<boolean> {
    const budget = this.budget;
    budget.charge("work", 1);
    if (test.kind === "type") {
      budget.charge("retainedBytes", test.value.length * 2);
      return test.namespace !== "none" && (test.value === "*" || await this.literal(node.name, node.namespace === "html" ? lower(test.value) : test.value));
    }
    if (test.kind === "id") { const value = await this.attribute(node, "id"); return value !== undefined && this.literal(value, test.value); }
    if (test.kind === "class") return this.word(await this.attribute(node, "class") ?? 0, test.value);
    if (test.kind === "attribute") {
      const value = await this.attribute(node, test.value), expected = test.expected;
      if (value === undefined) return false;
      switch (test.operator) {
        case "": return true;
        case "=": return this.literal(value, expected, test.insensitive);
        case "^=": return !!expected && this.literal(value, expected, test.insensitive, true);
        case "$=": {
          const length = (await this.text.info(value)).length;
          return !!expected && length >= expected.length && this.literal(await this.text.slice(value, length - expected.length), expected, test.insensitive);
        }
        case "*=": return this.contains(value, expected, test.insensitive);
        case "|=": return await this.literal(value, expected, test.insensitive) || this.literal(value, expected + "-", test.insensitive, true);
        case "~=": return this.word(value, expected, test.insensitive);
        default: return false;
      }
    }
    if (test.kind !== "pseudo") return false;
    const p = test.value;
    if (p === "not") return !await this.matches(node.id, test.negated!);
    if (p === "root" || p === "scope") return !!node.parent && (await this.tree.read(node.parent)).kind === "document";
    if (p === "any-link" || p === "link") return node.namespace === "html" && (await this.literal(node.name, "a") || await this.literal(node.name, "area") || await this.literal(node.name, "link")) && await this.attribute(node, "href") !== undefined;
    if (p === "empty") {
      for await (const child of this.tree.children(node.id)) {
        budget.charge("work", 1); const n = await this.tree.read(child);
        if (n.kind === "element" || n.kind === "text" && (await this.text.info(n.data)).length > 0) return false;
      }
      return true;
    }
    if (["visited", "active", "focus", "hover", "enabled", "disabled", "checked", "indeterminate"].includes(p)) return false;
    if (!p.includes("of-type") && (p.startsWith("first-") || p.startsWith("last-") || p.startsWith("only-"))) {
      if (!node.parent) return false;
      const sibling = async (direction: "previous" | "next"): Promise<boolean> => {
        for (let id = node[direction]; id;) {
          budget.charge("work", 1);
          const other = await this.tree.read(id);
          if (other.kind === "element") return true;
          id = other[direction];
        }
        return false;
      };
      if (p.startsWith("first-")) return !await sibling("previous");
      if (p.startsWith("last-")) return !await sibling("next");
      return !await sibling("previous") && !await sibling("next");
    }
    const [ordinal, count] = await this.rank(node, p.includes("of-type"));
    let index = ordinal;
    if (!index) return false;
    if (p.startsWith("first-")) return index === 1;
    if (p.startsWith("last-")) return index === count;
    if (p.startsWith("only-")) return count === 1;
    if (p.includes("last")) index = count - index + 1;
    const delta = index - test.b;
    return test.a === 0 ? delta === 0 : delta / test.a >= 0 && delta % test.a === 0;
  }

  async matches(id: number, program: Program): Promise<boolean> {
    const marker = this.pending.length;
    const push = async (node: number, at: number, depth: number, axis: number): Promise<void> => {
      await this.pending.push(node); await this.pending.push(at);
      await this.pending.push(depth); await this.pending.push(axis);
    };
    try {
      for (const parts of program) {
        await push(id, parts.length - 1, 0, 0);
        while (this.pending.length > marker) {
          const axis = (await this.pending.pop())!, depth = (await this.pending.pop())!, at = (await this.pending.pop())!;
          const node = await this.tree.read((await this.pending.pop())!);
          if (axis < 0) {
            const next = axis === -2 ? await this.previous(node.id) : node.parent;
            if (next) await push(next, at, depth, -axis);
            continue;
          }
          // Resume the next candidate only if this candidate and its remaining
          // selector fail. This preserves nearest-first matching and short-circuit work.
          if (axis > 0) await push(node.id, at, depth, -axis);
          if (axis === 1) this.budget.charge("work", 1);
          this.budget.bound("depth", depth); this.budget.charge("work", 1);
          if (node.kind !== "element") continue;
          let matches = true;
          for (const test of parts[at]!.tests) if (!await this.test(node, test)) { matches = false; break; }
          if (!matches) continue;
          if (!at) return true;
          const relation = parts[at]!.relation;
          const next = relation === "+" || relation === "~" ? await this.previous(node.id) : node.parent;
          if (next) await push(next, at - 1, depth + 1, relation === "~" ? 2 : relation === ">" || relation === "+" ? 0 : 1);
        }
      }
      return false;
    } finally { await this.pending.truncate(marker); }
  }

}

/** Compile synchronously before any mutation. Only traversal continuations,
 * rather than ancestor or sibling snapshots, stay in resident memory. */
export function selectStoredHtml(root: number, selector: string, tree: DocumentStore, text: TextStore, storage: PagedStorage, options: HtmlOptions): AsyncGenerator<number> {
  const budget = new HtmlBudget(options), program = new SelectorParser(selector, budget).list();
  const query = new StoredQueries(tree, text, storage, budget);
  return (async function* () {
    let id = root, start = true, depth = 0;
    while (id) {
      budget.charge("work", 1); budget.bound("depth", depth);
      const node = await tree.read(id), entering = start;
      if (start) {
        if (node.first) { id = node.first; depth++; } else start = false;
      } else {
        if (id === root) return;
        if (node.next) { id = node.next; start = true; }
        else { id = node.parent; depth = Math.max(0, depth - 1); }
      }
      if (entering) {
        budget.charge("work", 1);
        if (node.kind === "element" && await query.matches(node.id, program)) yield node.id;
      }
    }
  })();
}
