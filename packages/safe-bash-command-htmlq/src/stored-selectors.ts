import type { PagedStorage } from "@poe-code/safe-fs/storage";
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
  constructor(readonly tree: DocumentStore, readonly text: TextStore, storage: PagedStorage, readonly budget: HtmlBudget) {
    this.pending = new StoredSequence(storage);
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
    let index = 0, count = 0;
    if (node.parent) for await (const child of this.tree.children(node.parent)) {
      budget.charge("work", 1); const n = await this.tree.read(child);
      if (n.kind !== "element" || p.includes("of-type") && (n.namespace !== node.namespace || !await this.equal(n.name, node.name))) continue;
      count++; if (child === node.id) index = count;
    }
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
