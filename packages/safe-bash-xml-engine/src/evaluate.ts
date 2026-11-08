import { evaluateExpression, expressionText, matchesId, testPredicate } from "./predicate.js";
import type { XmlAttribute, XmlContent, XmlElement } from "@poe-code/safe-fs/core";
import type { StoredXmlDocument } from "./stored-document.js";
import type { Query, QueryStep } from "./query.js";
import { XmlBudget, XmlQueryError } from "./limits.js";

type Container = { kind: "document"; children: Node[] } | ElementNode;
interface ElementNode {
  kind: "element";
  value: XmlElement;
  children: Node[];
  attributes: AttributeNode[];
  namespaces?: NamespaceNode[];
}
interface AttributeNode {
  kind: "attribute";
  value: XmlAttribute;
}
interface NamespaceNode {
  kind: "namespace";
  value: XmlAttribute;
}
interface ContentNode {
  kind: Exclude<XmlContent["kind"], "element">;
  value: Exclude<XmlContent, XmlElement>;
}
export type Node = (Container | AttributeNode | NamespaceNode | ContentNode) & { parent?: Node; stored?: { document: StoredXmlDocument; reference: number } };
const xmlns = "http://www.w3.org/2000/xmlns/";

async function indexTree(
  root: XmlElement,
  budget: XmlBudget
): Promise<{ document: Container; order: Node[]; parentOf: Map<Node, Container>; namespaces: Map<string, string> }> {
  const namespaces = new Map<string, string>([["xml", "http://www.w3.org/XML/1998/namespace"]]);
  for (const attribute of root.attributes) {
    { const p = budget.tick(); if (p) await p; }
    if (attribute.namespace === xmlns && attribute.name !== "xmlns")
      namespaces.set(attribute.localName, attribute.value);
  }
  const document: Container = { kind: "document", children: [] };
  const order: Node[] = [document];
  const parentOf = new Map<Node, Container>();
  const pending: { parent: Container; content: XmlContent }[] = [
    { parent: document, content: root }
  ];
  while (pending.length) {
    { const _p = budget.tick(); if (_p) await _p; }
    const { parent, content } = pending.pop()!;
    if (content.kind === "element") {
      const node: Node & ElementNode = { kind: "element", value: content, children: [], attributes: [] };
      parent.children.push(node);
      parentOf.set(node, parent);
      node.parent = parent;
      order.push(node);
      node.namespaces = [];
      for (const [prefix, uri] of [...content.namespaces].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
        const checkpoint = budget.tick(); if (checkpoint) await checkpoint;
        if (!uri) continue;
        const selected: Node & NamespaceNode = { kind: "namespace", value: { name: prefix, localName: prefix, namespace: "", value: uri } };
        node.namespaces.push(selected);
        parentOf.set(selected, node);
        selected.parent = node;
        order.push(selected);
      }
      for (const attribute of content.attributes) {
        { const _p = budget.tick(); if (_p) await _p; }
        if (attribute.namespace === xmlns) continue;
        const selected: Node & AttributeNode = { kind: "attribute", value: attribute };
        node.attributes.push(selected);
        parentOf.set(selected, node);
        selected.parent = node;
        order.push(selected);
      }
      for (let index = content.content.length - 1; index >= 0; index--) {
        { const _p = budget.tick(); if (_p) await _p; }
        pending.push({ parent: node, content: content.content[index]! });
      }
    } else {
      const node: Node & ContentNode = { kind: content.kind, value: content };
      parent.children.push(node);
      parentOf.set(node, parent);
      node.parent = parent;
      order.push(node);
    }
  }
  return { document, order, parentOf, namespaces };
}

function matches(node: Node, step: QueryStep, namespace: string, localName: string): boolean {
  if (step.kind === "node" || step.kind === "self" || step.kind === "parent") return true;
  if (step.kind === "text") return node.kind === "text" || node.kind === "cdata";
  if (node.kind !== step.kind) return false;
  if (node.kind === "element" || node.kind === "attribute" || node.kind === "namespace") {
    return step.name === "*" || (node.value.namespace === namespace && (localName === "*" || node.value.localName === localName));
  }
  return false;
}

export async function evaluateScalar(query: Query, root: XmlElement, budget: XmlBudget): Promise<string> {
  const tree = await indexTree(root, budget);
  const result = await evaluateExpression(query.expression!, tree.document, 1, 1, budget,
    async selected => evaluatePaths(selected, tree, budget, tree.document));
  if (typeof result === "object") return (await expressionText(result, budget)).string();
  return formatScalar(result);
}

export function formatScalar(result: string | number | boolean): string {
  // xmllint prints scalar numbers using C %g (six significant digits).
  // Keep full precision during evaluation; rounding belongs only at output.
  if (typeof result === "number" && Number.isFinite(result)) {
    if (Object.is(result, -0)) return "-0";
    const rounded = Number(result.toPrecision(6));
    if (rounded !== 0 && (Math.abs(rounded) < 0.0001 || Math.abs(rounded) >= 1000000)) {
      const [mantissa, exponent] = rounded.toExponential().split("e") as [string, string];
      return `${mantissa}e${exponent[0]}${exponent.slice(1).padStart(2, "0")}`;
    }
    return String(rounded);
  }
  return String(result);
}

export async function evaluate(query: Query, root: XmlElement, budget: XmlBudget): Promise<Node[]> {
  const tree = await indexTree(root, budget);
  return evaluatePaths(query, tree, budget, tree.document);
}
async function evaluatePaths(query: Query, tree: Awaited<ReturnType<typeof indexTree>>, budget: XmlBudget, context: Node): Promise<Node[]> {
  if (query.idTokens) {
    const selected: Node[] = [];
    for (const node of tree.order) {
      if (await matchesId(node, query.idTokens, budget)) {
        budget.results(selected.length + 1);
        selected.push(node);
      }
    }
    return selected;
  }
  if (query.expression) {
    const value = await evaluateExpression(query.expression, context, 1, 1, budget,
      (selected, absolute) => evaluatePaths(selected, tree, budget, absolute ? tree.document : context));
    if (typeof value !== "object" || !("nodes" in value)) throw new XmlQueryError("XPath filter requires a node-set", 10);
    const selected: Node[] = [];
    for await (const node of value.nodes()) selected.push(node);
    return selected;
  }
  const filter = async (matched: Node[], predicates: QueryStep["predicates"]): Promise<Node[]> => {
    for (const predicate of predicates) {
      { const _p = budget.tick(); if (_p) await _p; }
      const first = predicate[0];
      if (predicate.length === 1 && first?.kind === "literal" && typeof first.value === "number") {
        matched = matched[first.value - 1] ? [matched[first.value - 1]!] : [];
        continue;
      }
      if (predicate.length === 1 && first?.kind === "function" && first.name === "last") {
        matched = matched.length ? [matched[matched.length - 1]!] : [];
        continue;
      }
      const filtered: Node[] = [];
      for (let index = 0; index < matched.length; index++) {
        const candidate = matched[index]!;
        if (await testPredicate(predicate, candidate, index + 1, matched.length, budget,
          async (selected, absolute) => evaluatePaths(selected, tree, budget, absolute ? tree.document : candidate)))
          filtered.push(candidate);
      }
      matched = filtered;
    }
    return matched;
  };
  if (query.filter) {
    const { input, predicates } = query.filter;
    return filter(await evaluatePaths(input.query!, tree, budget, input.source.startsWith("/") ? tree.document : context), predicates);
  }
  const { order, parentOf } = tree;
  const union = new Set<Node>();
  for (const path of query.paths) {
    let contexts: Node[] = [context];
    for (const step of path) {
      const colon = step.name.indexOf(":");
      const prefix = colon < 0 ? "" : step.name.slice(0, colon);
      const namespace = colon < 0 ? "" : tree.namespaces.get(prefix);
      if (namespace === undefined)
        throw new XmlQueryError(`undefined XPath namespace prefix: ${prefix}`, 10);
      const localName = colon < 0 ? step.name : step.name.slice(colon + 1);
      const parents = new Set<Node>();
      const pending = [...contexts];
      while (pending.length) {
        { const _p = budget.tick(); if (_p) await _p; }
        const node = pending.pop()!;
        if (parents.has(node)) continue;
        parents.add(node);
        if (step.descendant && (node.kind === "document" || node.kind === "element")) {
          for (const child of node.children) {
            { const _p = budget.tick(); if (_p) await _p; }
            pending.push(child);
          }
        }
      }
      const selected = new Set<Node>();
      for (const parent of parents) {
        { const _p = budget.tick(); if (_p) await _p; }
        const axis = step.axis ?? (["self", "parent", "namespace", "attribute"].includes(step.kind) ? step.kind : "child");
        async function* descendants(node: Node): AsyncGenerator<Node> {
          const pending: Node[] = [node];
          while (pending.length) {
            const checkpoint = budget.tick(); if (checkpoint) await checkpoint;
            const current = pending.pop()!;
            yield current;
            if (current.kind === "element" || current.kind === "document")
              for (let index = current.children.length - 1; index >= 0; index--) {
                const checkpoint = budget.tick(); if (checkpoint) await checkpoint;
                pending.push(current.children[index]!);
              }
          }
        }
        async function* candidates(): AsyncGenerator<Node> {
          if (axis === "self") { yield parent; return; }
          if (axis === "parent") { const owner = parentOf.get(parent); if (owner) yield owner; return; }
          if (axis === "ancestor" || axis === "ancestor-or-self") {
            let current: Node | undefined = axis === "ancestor" ? parentOf.get(parent) : parent;
            while (current) {
              const checkpoint = budget.tick(); if (checkpoint) await checkpoint;
              yield current; current = parentOf.get(current);
            }
            return;
          }
          if (axis === "descendant" || axis === "descendant-or-self") {
            for await (const node of descendants(parent))
              if (node !== parent || axis === "descendant-or-self") yield node;
            return;
          }
          if (axis === "following" || axis === "preceding" || axis === "following-sibling" || axis === "preceding-sibling") {
            if (axis.endsWith("-sibling") && (parent.kind === "attribute" || parent.kind === "namespace")) return;
            let current: Node = parent;
            if (current.kind === "attribute" || current.kind === "namespace") {
              current = parentOf.get(current)!;
            }
            while (parentOf.has(current)) {
              const owner: Container = parentOf.get(current)!;
              let after = false;
              const siblings: Node[] = [];
              for (const sibling of owner.children) {
                const checkpoint = budget.tick(); if (checkpoint) await checkpoint;
                if (sibling === current) { after = true; continue; }
                if (after === axis.startsWith("following")) siblings.push(sibling);
              }
              if (axis.startsWith("preceding")) siblings.reverse();
              for (const sibling of siblings) {
                if (axis.endsWith("-sibling")) yield sibling;
                else if (axis === "following") yield* descendants(sibling);
                else {
                  const subtree: Node[] = [];
                  for await (const node of descendants(sibling)) subtree.push(node);
                  yield* subtree.reverse();
                }
              }
              if (axis.endsWith("-sibling")) return;
              current = owner;
            }
            return;
          }
          if (parent.kind === "element") {
            if (axis === "attribute") yield* parent.attributes;
            else if (axis === "namespace") yield* parent.namespaces ?? [];
            else yield* parent.children;
          } else if (parent.kind === "document" && axis === "child") yield* parent.children;
        }
        let matched: Node[] = [];
        for await (const candidate of candidates()) {
          { const _p = budget.tick(); if (_p) await _p; }
          if (matches(candidate, step, namespace, localName)) matched.push(candidate);
        }
        matched = await filter(matched, step.predicates);
        for (const node of matched) {
          { const _p = budget.tick(); if (_p) await _p; }
          if (!selected.has(node)) {
            budget.results(selected.size + 1);
            selected.add(node);
          }
        }
      }
      contexts = [];
      for (const node of order) {
        { const _p = budget.tick(); if (_p) await _p; }
        if (selected.has(node)) contexts.push(node);
      }
    }
    for (const node of contexts) {
      { const _p = budget.tick(); if (_p) await _p; }
      budget.results(union.size + (union.has(node) ? 0 : 1));
      union.add(node);
    }
  }
  const result: Node[] = [];
  for (const node of order) {
    { const _p = budget.tick(); if (_p) await _p; }
    if (union.has(node)) result.push(node);
  }
  return result;
}

export async function* stringValue(
  node: Node | undefined,
  budget: XmlBudget
): AsyncGenerator<string> {
  if (node === undefined) return;
  if (node.kind === "attribute" || node.kind === "namespace") {
    if (node.stored) yield* node.stored.document.text(node.stored.reference);
    else yield node.value.value;
    return;
  }
  if (node.stored) {
    const { document, reference } = node.stored;
    for await (const event of document.walk(node.kind === "document" ? document.root : reference)) {
      if (event.closing) continue;
      const value = await document.metadata(event.reference);
      if (value.kind === "text" || value.kind === "cdata") yield* document.text(event.reference);
    }
    return;
  }
  const pending: Node[] = [node];
  while (pending.length) {
    { const _p = budget.tick(); if (_p) await _p; }
    const current = pending.pop()!;
    if (current.kind === "element" || current.kind === "document") {
      for (let index = current.children.length - 1; index >= 0; index--) {
        { const _p = budget.tick(); if (_p) await _p; }
        pending.push(current.children[index]!);
      }
    } else if (current.kind === "text" || current.kind === "cdata") yield current.value.text;
  }
}

export function serializeSimpleSync(node: Node, budget: XmlBudget): string | undefined {
  if (
    !node.stored && node.kind === "text" &&
    node.value.text.length > 0 &&
    node.value.text.length < 4096 &&
    !/[&<>"\n\r\t\uD800-\uDFFF]/.test(node.value.text)
  ) {
    if (!budget.tryTickSync(1 + node.value.text.length)) return undefined;
    return node.value.text;
  }
  return undefined;
}

export async function* serialize(node: Node, budget: XmlBudget): AsyncGenerator<string> {
  if (!node.stored && node.kind === "text" && node.value.text.length > 0 && node.value.text.length < 4096 && !/[&<>"\n\r\t\uD800-\uDFFF]/.test(node.value.text)) {
    { const _p = budget.tick(1 + node.value.text.length); if (_p) await _p; }
    yield node.value.text;
    return;
  }
  if (node.kind === "attribute" || node.kind === "namespace") {
    if (node.kind === "namespace") {
      yield " xmlns";
      if (node.stored) {
        let first = true;
        for await (const part of node.stored.document.nameText(node.value)) {
          if (!part) continue;
          if (first) { yield ":"; first = false; }
          yield part;
        }
      } else if (node.value.name) yield `:${node.value.name}`;
      yield '="';
    }
    else if (node.stored) { yield " "; yield* node.stored.document.nameText(node.value); yield '="'; }
    else yield ` ${node.value.name}="`;
    for await (const part of stringValue(node, budget)) yield* escape(part, true, budget);
    yield '"';
    return;
  }
  if (node.stored) {
    const { document, reference } = node.stored;
    if (node.kind === "document") yield '<?xml version="1.0" encoding="UTF-8"?>\n';
    for await (const event of document.walk(node.kind === "document" ? document.root : reference)) {
      const value = await document.metadata(event.reference);
      if (value.kind === "element") {
        let hasChildren = false;
        for await (const ignored of document.children(event.reference)) { hasChildren = true; break; }
        if (event.closing) { if (hasChildren) { yield "</"; yield* document.nameText(value); yield ">"; } continue; }
        yield "<"; yield* document.nameText(value);
        for await (const attribute of document.attributes(event.reference)) {
          const p = budget.tick(); if (p) await p;
          yield " "; yield* document.nameText(attribute); yield '="';
          for await (const part of document.attributeText(attribute)) yield* escape(part, true, budget);
          yield '"';
        }
        yield hasChildren ? ">" : "/>";
      } else if (!event.closing && value.kind !== "attribute") {
        if (value.kind === "text") {
          for await (const part of document.text(event.reference)) yield* escape(part, false, budget);
        } else if (value.kind === "cdata") {
          yield "<![CDATA[";
          yield* document.text(event.reference);
          yield "]]>";
        } else if (value.kind === "comment") {
          yield "<!--";
          yield* document.text(event.reference);
          yield "-->";
        } else if (value.kind === "processing-instruction") {
          yield "<?"; yield* document.targetText(value);
          if (value.text) { yield " "; yield* document.text(event.reference); }
          yield "?>";
        }
      }
    }
    if (node.kind === "document") yield "\n";
    return;
  }
  if (node.kind === "document") {
    yield '<?xml version="1.0" encoding="UTF-8"?>\n';
    for (const child of node.children) {
      yield* serialize(child, budget);
      yield "\n";
    }
    return;
  }
  const pending: (XmlContent | string)[] = [node.value];
  while (pending.length) {
    { const _p = budget.tick(); if (_p) await _p; }
    const current = pending.pop()!;
    if (typeof current === "string") {
      yield current;
      continue;
    }
    if (current.kind === "element") {
      yield `<${current.name}`;
      for (const attribute of current.attributes) {
        { const _p = budget.tick(); if (_p) await _p; }
        yield ` ${attribute.name}="`;
        yield* escape(attribute.value, true, budget);
        yield '"';
      }
      if (!current.content.length) yield "/>";
      else {
        yield ">";
        pending.push(`</${current.name}>`);
        for (let index = current.content.length - 1; index >= 0; index--) {
          { const _p = budget.tick(); if (_p) await _p; }
          pending.push(current.content[index]!);
        }
      }
    } else if (current.kind === "text") yield* escape(current.text, false, budget);
    else if (current.kind === "cdata") {
      yield "<![CDATA[";
      yield current.text;
      yield "]]>";
    } else if (current.kind === "comment") {
      yield "<!--";
      yield current.text;
      yield "-->";
    } else if (current.kind === "processing-instruction") {
      yield `<?${current.target}`;
      if (current.text) {
        yield " ";
        yield current.text;
      }
      yield "?>";
    }
  }
}

export async function* escape(
  value: string,
  attribute: boolean,
  budget: XmlBudget,
  options: { canonical?: boolean; ascii?: boolean } = {}
): AsyncGenerator<string> {
  if (value.length > 0 && value.length < 4096 && !options.ascii && !/[&<>"\n\r\t\uD800-\uDFFF]/.test(value)) {
    { const _p = budget.tick(value.length); if (_p) await _p; }
    yield value;
    return;
  }
  let part = "";
  for (const character of value) {
    { const _p = budget.tick(); if (_p) await _p; }
    part +=
      character === "&"
        ? "&amp;"
        : character === "<"
          ? "&lt;"
          : character === ">" && !(attribute && options.canonical)
            ? "&gt;"
            : attribute && character === '"'
              ? "&quot;"
              : attribute && character === "\n"
                ? options.canonical
                  ? "&#xA;"
                  : "&#10;"
                : character === "\r"
                  ? options.canonical
                    ? "&#xD;"
                    : "&#13;"
                  : attribute && character === "\t"
                    ? options.canonical
                      ? "&#x9;"
                      : "&#9;"
                    : options.ascii && character.codePointAt(0)! >= 128
                      ? `&#x${character.codePointAt(0)!.toString(16).toUpperCase()};`
                      : character;
    if (part.length >= 4096) {
      yield part;
      part = "";
    }
  }
  if (part) yield part;
}
