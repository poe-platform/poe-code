import type { XmlAttribute, XmlContent, XmlElement } from "poe-code/safe-fs/core";
import type { Query, QueryStep } from "./query.js";
import { XmlBudget } from "./limits.js";

type Container = { kind: "document"; children: Node[] } | ElementNode;
interface ElementNode { kind: "element"; value: XmlElement; children: Node[]; attributes: AttributeNode[] }
interface AttributeNode { kind: "attribute"; value: XmlAttribute }
interface ContentNode { kind: Exclude<XmlContent["kind"], "element">; value: Exclude<XmlContent, XmlElement> }
export type Node = Container | AttributeNode | ContentNode;
const xmlns = "http://www.w3.org/2000/xmlns/";

async function indexTree(root: XmlElement, budget: XmlBudget): Promise<{ document: Container; order: Node[] }> {
  const document: Container = { kind: "document", children: [] };
  const order: Node[] = [document];
  const pending: { parent: Container; content: XmlContent }[] = [{ parent: document, content: root }];
  while (pending.length) {
    await budget.tick();
    const { parent, content } = pending.pop()!;
    if (content.kind === "element") {
      const node: ElementNode = { kind: "element", value: content, children: [], attributes: [] };
      parent.children.push(node); order.push(node);
      for (const attribute of content.attributes) {
        await budget.tick();
        if (attribute.namespace === xmlns) continue;
        const selected: AttributeNode = { kind: "attribute", value: attribute };
        node.attributes.push(selected); order.push(selected);
      }
      for (let index = content.content.length - 1; index >= 0; index--) {
        await budget.tick(); pending.push({ parent: node, content: content.content[index]! });
      }
    } else {
      const node: ContentNode = { kind: content.kind, value: content };
      parent.children.push(node); order.push(node);
    }
  }
  return { document, order };
}

function matches(node: Node, step: QueryStep): boolean {
  if (step.kind === "text") return node.kind === "text" || node.kind === "cdata";
  if (node.kind !== step.kind) return false;
  if (node.kind === "element" || node.kind === "attribute") {
    return step.name === "*" || node.value.namespace === "" && node.value.localName === step.name;
  }
  return false;
}

export async function evaluate(query: Query, root: XmlElement, budget: XmlBudget): Promise<Node[]> {
  const { document, order } = await indexTree(root, budget);
  let contexts: Node[] = [document];
  for (const step of query.steps) {
    const parents = new Set<Node>();
    const pending = [...contexts];
    while (pending.length) {
      await budget.tick();
      const node = pending.pop()!;
      if (parents.has(node)) continue;
      parents.add(node);
      if (step.descendant && (node.kind === "document" || node.kind === "element")) {
        for (const child of node.children) { await budget.tick(); pending.push(child); }
      }
    }
    const selected = new Set<Node>();
    for (const parent of parents) {
      await budget.tick();
      const candidates = step.kind === "attribute"
        ? parent.kind === "element" ? parent.attributes : []
        : parent.kind === "element" || parent.kind === "document" ? parent.children : [];
      let matched: Node[] = [];
      for (const candidate of candidates) {
        await budget.tick();
        if (matches(candidate, step)) matched.push(candidate);
      }
      for (const predicate of step.predicates) {
        await budget.tick();
        if (predicate.kind === "position") matched = matched[predicate.value - 1] ? [matched[predicate.value - 1]!] : [];
        else {
          const filtered: Node[] = [];
          for (const candidate of matched) {
            await budget.tick();
            if (candidate.kind !== "element") continue;
            for (const attribute of candidate.attributes) {
              await budget.tick(attribute.value.value.length + 1);
              if (attribute.value.namespace === "" && attribute.value.localName === predicate.name && attribute.value.value === predicate.value) {
                filtered.push(candidate); break;
              }
            }
          }
          matched = filtered;
        }
      }
      for (const node of matched) { await budget.tick(); if (!selected.has(node)) { budget.results(selected.size + 1); selected.add(node); } }
    }
    contexts = [];
    for (const node of order) { await budget.tick(); if (selected.has(node)) contexts.push(node); }
  }
  return contexts;
}

export async function* stringValue(node: Node | undefined, budget: XmlBudget): AsyncGenerator<string> {
  if (node === undefined) return;
  if (node.kind === "attribute") { yield node.value.value; return; }
  const pending: Node[] = [node];
  while (pending.length) {
    await budget.tick();
    const current = pending.pop()!;
    if (current.kind === "element" || current.kind === "document") {
      for (let index = current.children.length - 1; index >= 0; index--) {
        await budget.tick(); pending.push(current.children[index]!);
      }
    } else if (current.kind === "text" || current.kind === "cdata") yield current.value.text;
  }
}

export async function* serialize(node: Node, budget: XmlBudget): AsyncGenerator<string> {
  if (node.kind === "attribute") {
    yield ` ${node.value.name}="`; yield* escape(node.value.value, true, budget); yield '"'; return;
  }
  if (node.kind === "document") return;
  const pending: (XmlContent | string)[] = [node.value];
  while (pending.length) {
    await budget.tick();
    const current = pending.pop()!;
    if (typeof current === "string") { yield current; continue; }
    if (current.kind === "element") {
      yield `<${current.name}`;
      for (const attribute of current.attributes) {
        await budget.tick(); yield ` ${attribute.name}="`; yield* escape(attribute.value, true, budget); yield '"';
      }
      if (!current.content.length) yield "/>";
      else {
        yield ">"; pending.push(`</${current.name}>`);
        for (let index = current.content.length - 1; index >= 0; index--) {
          await budget.tick(); pending.push(current.content[index]!);
        }
      }
    } else if (current.kind === "text") yield* escape(current.text, false, budget);
    else if (current.kind === "cdata") { yield "<![CDATA["; yield current.text; yield "]]>"; }
    else if (current.kind === "comment") { yield "<!--"; yield current.text; yield "-->"; }
    else if (current.kind === "processing-instruction") { yield `<?${current.target}`; if (current.text) { yield " "; yield current.text; } yield "?>"; }
  }
}

async function* escape(value: string, attribute: boolean, budget: XmlBudget): AsyncGenerator<string> {
  let part = "";
  for (const character of value) {
    await budget.tick();
    part += character === "&" ? "&amp;" : character === "<" ? "&lt;" : character === ">" ? "&gt;"
      : attribute && character === '"' ? "&quot;" : attribute && character === "\n" ? "&#10;"
        : character === "\r" ? "&#13;" : attribute && character === "\t" ? "&#9;" : character;
    if (part.length >= 4096) { yield part; part = ""; }
  }
  if (part) yield part;
}
