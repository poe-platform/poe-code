import { IntegerTable } from "@poe-code/safe-fs/storage";
import { formatScalar, type Node } from "./evaluate.js";
import { XmlBudget, XmlQueryError } from "./limits.js";
import { evaluateExpression, expressionText, matchesId, testPredicate, type NodeSelection } from "./predicate.js";
import type { Axis, Query, QueryStep } from "./query.js";
import { StoredXmlDocument } from "./stored-document.js";

/** Ordered references in the document's shared page cache. Selection caches are
 * small fixed windows, and metadata is loaded only while visiting a result. */
class StoredSelection implements NodeSelection {
  private table: IntegerTable | undefined;
  private readonly initial = new Set<number>();
  size = 0;
  private namespaces = false;
  constructor(private readonly evaluator: StoredXPath) {}
  async add(reference: number): Promise<void> {
    if (this.evaluator.document.isNamespaceNode(reference)) this.namespaces = true;
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
    if (this.namespaces) {
      const has = async (reference: number): Promise<boolean> => this.table
        ? await this.table.get(BigInt(reference)) !== undefined : this.initial.has(reference);
      const document = this.evaluator.document;
      const owners = new StoredSelection(this.evaluator);
      for await (const reference of this.rawReferences())
        await owners.add(document.isNamespaceNode(reference) ? await document.parent(reference) : reference);
      for await (const owner of owners.references()) {
        if (await has(owner)) yield owner;
        for await (const reference of document.namespaceNodes(owner, false)) if (await has(reference)) yield reference;
      }
      return;
    }
    yield* this.rawReferences();
  }
  private async *rawReferences(): AsyncGenerator<number> {
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

async function matches(node: Node, step: QueryStep, namespace: string | number, localName: string, document: StoredXmlDocument): Promise<boolean> {
  if (step.kind === "node" || step.kind === "self" || step.kind === "parent") return true;
  if (step.kind === "text") return node.kind === "text" || node.kind === "cdata";
  if (node.kind !== step.kind) return false;
  return (node.kind === "element" || node.kind === "attribute" || node.kind === "namespace") &&
    (step.name === "*" || (localName === "*" || await document.nameEquals(node.value, localName, true)) && await document.namespaceEquals(node.value, namespace));
}

export class StoredXPath {
  constructor(
    readonly document: StoredXmlDocument,
    readonly budget: XmlBudget,
    private readonly namespaceContext = document.root
  ) {}

  async node(reference: number): Promise<Node> {
    const stored = { document: this.document, reference };
    if (reference === this.document.document) return { kind: "document", children: [], stored };
    const value = await this.document.metadata(reference);
    if (value.kind === "attribute") return { kind: value.namespaceNode ? "namespace" : "attribute", value: value.value, stored };
    if (value.kind === "element") return { kind: "element", value, children: [], attributes: [], stored };
    return { kind: value.kind, value, stored };
  }

  private async *children(reference: number, attributes = false): AsyncGenerator<number> {
    if (reference === this.document.document) {
      if (!attributes) yield this.document.root;
    } else yield* this.document.children(reference, attributes);
  }

  private async *candidates(reference: number, axis: Axis): AsyncGenerator<number> {
    const document = this.document;
    if (axis === "self") { yield reference; return; }
    if (axis === "parent") {
      if (reference !== document.document) yield await document.parent(reference);
      return;
    }
    if (axis === "ancestor" || axis === "ancestor-or-self") {
      let current = reference;
      if (axis === "ancestor-or-self") yield current;
      while (current !== document.document) {
        const checkpoint = this.budget.tick(); if (checkpoint) await checkpoint;
        current = await document.parent(current);
        yield current;
      }
      return;
    }
    if (axis === "descendant" || axis === "descendant-or-self") {
      if (axis === "descendant-or-self") yield reference;
      if (reference !== document.document && (await document.metadata(reference)).kind !== "element") return;
      for await (const event of document.walk(reference === document.document ? document.root : reference))
        if (!event.closing && event.reference !== reference) yield event.reference;
      return;
    }
    if (axis === "following" || axis === "preceding" || axis === "following-sibling" || axis === "preceding-sibling") {
      if (reference === document.document) return;
      let current = reference;
      if ((await document.metadata(current)).kind === "attribute") {
        if (axis.endsWith("-sibling")) return;
        current = await document.parent(current);
      }
      while (current !== document.document) {
        const owner = await document.parent(current);
        let after = false;
        for await (const sibling of this.children(owner)) {
          if (sibling === current) { after = true; continue; }
          if (after !== axis.startsWith("following")) continue;
          if (axis.endsWith("-sibling")) yield sibling;
          else for await (const event of document.walk(sibling)) if (!event.closing) yield event.reference;
        }
        if (axis.endsWith("-sibling")) return;
        current = owner;
      }
      return;
    }
    if (axis === "namespace") yield* document.namespaceNodes(reference);
    else yield* this.children(reference, axis === "attribute");
  }

  private async filter(matched: StoredSelection, predicates: QueryStep["predicates"], reverse = false): Promise<StoredSelection> {
    for (const predicate of predicates) {
      const filtered = new StoredSelection(this);
      const first = predicate[0];
      const positionOnly = predicate.length === 1 && first?.kind === "literal" && typeof first.value === "number" ? first.value
        : predicate.length === 1 && first?.kind === "function" && first.name === "last" ? matched.size : undefined;
      let position = 0;
      for await (const reference of matched.references()) {
        position++;
        const axisPosition = reverse ? matched.size - position + 1 : position;
        if (positionOnly !== undefined) {
          if (axisPosition === positionOnly) { await filtered.add(reference); break; }
        } else if (await testPredicate(predicate, await this.node(reference), axisPosition, matched.size, this.budget,
          (query, absolute) => this.select(query, absolute ? this.document.document : reference))) await filtered.add(reference);
      }
      matched = filtered;
    }
    return matched;
  }

  async select(query: Query, context = this.document.document): Promise<StoredSelection> {
    if (query.idTokens) {
      const selected = new StoredSelection(this);
      for await (const event of this.document.walk(this.document.root)) {
        if (!event.closing && await matchesId(await this.node(event.reference), query.idTokens, this.budget)) {
          await selected.add(event.reference);
          this.budget.results(selected.size);
        }
      }
      return selected;
    }
    if (query.expression) {
      const value = await evaluateExpression(query.expression, await this.node(context), 1, 1, this.budget,
        (selected, absolute) => this.select(selected, absolute ? this.document.document : context));
      if (typeof value !== "object" || !("nodes" in value)) throw new XmlQueryError("XPath filter requires a node-set", 10);
      const selected = new StoredSelection(this);
      for await (const node of value.nodes()) await selected.add(node.stored!.reference);
      return selected;
    }
    if (query.filter) {
      const { input, predicates } = query.filter;
      return this.filter(await this.select(input.query!, input.source.startsWith("/") ? this.document.document : context), predicates);
    }
    const namespaces = await this.document.namespaceScope(this.namespaceContext);
    const union = new StoredSelection(this);
    for (const path of query.paths) {
      let contexts = new StoredSelection(this);
      await contexts.add(context);
      for (const step of path) {
        const colon = step.name.indexOf(":");
        const prefix = colon < 0 ? "" : step.name.slice(0, colon);
        const namespace = colon < 0 ? "" : await namespaces.lookup(prefix);
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
          const axis = step.axis ?? (step.kind === "self" || step.kind === "parent" || step.kind === "namespace" || step.kind === "attribute" ? step.kind : "child");
          const candidates = this.candidates(parent, axis);
          for await (const candidate of candidates) {
            if (await matches(await this.node(candidate), step, namespace, localName, this.document)) await matched.add(candidate);
          }
          matched = await this.filter(matched, step.predicates, axis === "ancestor" || axis === "ancestor-or-self" || axis === "preceding" || axis === "preceding-sibling");
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

  /** Buffering convenience; command output consumes scalarChunks directly. */
  async scalar(query: Query): Promise<string> {
    let result = "";
    for await (const part of this.scalarChunks(query)) result += part;
    return result;
  }

  async *scalarChunks(query: Query): AsyncGenerator<string> {
    const value = await evaluateExpression(query.expression!, await this.node(this.document.document), 1, 1, this.budget,
      selected => this.select(selected));
    if (typeof value === "object") yield* (await expressionText(value, this.budget, this.document.storage)).chunks();
    else yield formatScalar(value);
  }
}
