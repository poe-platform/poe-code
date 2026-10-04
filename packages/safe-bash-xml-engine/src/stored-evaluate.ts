import { IntegerTable } from "@poe-code/safe-fs/storage";
import type { XmlElement } from "@poe-code/safe-fs/core";
import { formatScalar, type Node } from "./evaluate.js";
import { XmlBudget, XmlQueryError } from "./limits.js";
import { evaluateExpression, expressionString, testPredicate, type NodeSelection } from "./predicate.js";
import type { Query, QueryStep } from "./query.js";
import { StoredXmlDocument } from "./stored-document.js";

/** Ordered references in the document's shared page cache. Selection caches are
 * small fixed windows, and metadata is loaded only while visiting a result. */
class StoredSelection implements NodeSelection {
  private table: IntegerTable | undefined;
  private readonly initial = new Set<number>();
  size = 0;
  constructor(private readonly evaluator: StoredXPath) {}
  async add(reference: number): Promise<void> {
    if (!this.table) {
      if (this.initial.has(reference)) return;
      if (this.initial.size < 128) { this.initial.add(reference); this.size++; return; }
      this.table = new IntegerTable(this.evaluator.document.storage, 128);
      for (const retained of this.initial) await this.table.set(BigInt(retained), 0n);
      this.initial.clear();
    }
    const key = BigInt(reference);
    if (await this.table.get(key) !== undefined) return;
    await this.table.set(key, 0n);
    this.size++;
  }
  async *references(): AsyncGenerator<number> {
    if (!this.table) {
      for (const reference of [...this.initial].sort((a, b) => a - b)) {
        const checkpoint = this.evaluator.budget.tick(); if (checkpoint) await checkpoint;
        yield reference;
      }
      return;
    }
    for await (const [reference] of this.table.entries()) {
      const checkpoint = this.evaluator.budget.tick(); if (checkpoint) await checkpoint;
      yield Number(reference);
    }
  }
  async *nodes(): AsyncGenerator<Node> {
    for await (const reference of this.references()) yield await this.evaluator.node(reference);
  }
}

function matches(node: Node, step: QueryStep, namespace: string, localName: string): boolean {
  if (step.kind === "self" || step.kind === "parent") return true;
  if (step.kind === "text") return node.kind === "text" || node.kind === "cdata";
  if (node.kind !== step.kind) return false;
  return (node.kind === "element" || node.kind === "attribute") &&
    (step.name === "*" || node.value.namespace === namespace && node.value.localName === localName);
}

export class StoredXPath {
  constructor(readonly document: StoredXmlDocument, readonly budget: XmlBudget) {}

  async node(reference: number): Promise<Node> {
    const stored = { document: this.document, reference };
    if (reference === this.document.document) return { kind: "document", children: [], stored };
    const value = await this.document.node(reference);
    if (value.kind === "attribute") return { ...value, stored };
    if (value.kind === "element") return { kind: "element", value, children: [], attributes: [], stored };
    return { kind: value.kind, value, stored };
  }

  private async *children(reference: number, attributes = false): AsyncGenerator<number> {
    if (reference === this.document.document) {
      if (!attributes) yield this.document.root;
    } else yield* this.document.children(reference, attributes);
  }

  async select(query: Query, context = this.document.document): Promise<StoredSelection> {
    const root = await this.document.node(this.document.root) as XmlElement;
    const union = new StoredSelection(this);
    for (const path of query.paths) {
      let contexts = new StoredSelection(this);
      await contexts.add(context);
      for (const step of path) {
        const colon = step.name.indexOf(":");
        const prefix = colon < 0 ? "" : step.name.slice(0, colon);
        const namespace = colon < 0 ? "" : root.namespaces.get(prefix);
        if (namespace === undefined) throw new XmlQueryError(`undefined XPath namespace prefix: ${prefix}`, 10);
        const localName = colon < 0 ? step.name : step.name.slice(colon + 1);
        const parents = new StoredSelection(this);
        for await (const reference of contexts.references()) {
          await parents.add(reference);
          if (!step.descendant) continue;
          for await (const event of this.document.walk(reference === this.document.document ? this.document.root : reference)) {
            if (!event.closing) await parents.add(event.reference);
          }
        }
        const selected = new StoredSelection(this);
        for await (const parent of parents.references()) {
          let matched = new StoredSelection(this);
          const candidates = step.kind === "self" ? [parent]
            : step.kind === "parent" ? parent === this.document.document ? [] : [await this.document.parent(parent)]
            : this.children(parent, step.kind === "attribute");
          for await (const candidate of candidates) {
            if (matches(await this.node(candidate), step, namespace, localName)) await matched.add(candidate);
          }
          for (const predicate of step.predicates) {
            const filtered = new StoredSelection(this);
            const first = predicate[0];
            const positionOnly = predicate.length === 1 && first?.kind === "literal" && typeof first.value === "number" ? first.value
              : predicate.length === 1 && first?.kind === "function" && first.name === "last" ? matched.size : undefined;
            let position = 0;
            for await (const reference of matched.references()) {
              position++;
              if (positionOnly !== undefined) {
                if (position === positionOnly) { await filtered.add(reference); break; }
              } else if (await testPredicate(predicate, await this.node(reference), position, matched.size, this.budget,
                (query, absolute) => this.select(query, absolute ? this.document.document : reference))) await filtered.add(reference);
            }
            matched = filtered;
          }
          for await (const reference of matched.references()) {
            await selected.add(reference);
            this.budget.results(selected.size);
          }
        }
        contexts = selected;
      }
      for await (const reference of contexts.references()) {
        await union.add(reference);
        this.budget.results(union.size);
      }
    }
    return union;
  }

  async scalar(query: Query): Promise<string> {
    const value = await evaluateExpression(query.expression!, await this.node(this.document.document), 1, 1, this.budget,
      selected => this.select(selected));
    return typeof value === "object" ? expressionString(value, this.budget) : formatScalar(value);
  }
}
