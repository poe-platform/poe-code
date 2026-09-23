import { HtmlBudget, HtmlError, type HtmlNode, type HtmlOptions } from "./contracts.js";
import { rawElements, voidElements } from "./tokenizer.js";
import { originalSource, ownsHtmlNode } from "./tree.js";
const inlineElements = new Set("a abbr acronym audio b bdi bdo big button canvas cite code data datalist del dfn em embed i iframe img input ins kbd label map mark meter noscript object output picture progress q ruby s samp script select slot small span strong sub sup svg template textarea time u tt var video wbr".split(" "));
/** Rust char::is_whitespace excludes BOM and includes NEL. */
export function rustWhitespaceOnly(data: string): boolean {
  for (const c of data) {
    const n = c.codePointAt(0)!;
    if (!(n >= 9 && n <= 13 || n === 32 || n === 0x85 || n === 0xa0 || n === 0x1680 || n >= 0x2000 && n <= 0x200a || n === 0x2028 || n === 0x2029 || n === 0x202f || n === 0x205f || n === 0x3000)) return false;
  }
  return true;
}
function byteLength(data: string): number {
  let length = 0;
  for (const c of data) {
    const n = c.codePointAt(0)!;
    length += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4;
  }
  return length;
}
function* escaped(data: string, attribute: boolean): Generator<string> {
  for (const c of data)
    yield c === "&"
      ? "&amp;"
      : c === "\u00a0"
        ? "&nbsp;"
        : attribute && c === '"'
          ? "&quot;"
          : !attribute && c === "<"
            ? "&lt;"
            : !attribute && c === ">"
              ? "&gt;"
              : c;
}
/** Depth-first traversal uses a depth-sized stack, never a snapshot of descendants. */
function* pieces(
  node: HtmlNode,
  budget: HtmlBudget,
  mode: "normalized" | "original" | "pretty"
): Generator<string> {
  if (!ownsHtmlNode(node)) throw new HtmlError("E_OWNERSHIP", "Unowned HTML node");
  if (mode === "original") {
    yield originalSource(node);
    return;
  }
  let indent = 0, previousWasBlock = false;
  const stack: { node: HtmlNode; child: number; opened: boolean }[] = [
    { node, child: 0, opened: false }
  ];
  while (stack.length) {
    budget.charge("work", 1);
    budget.bound("depth", stack.length - 1);
    budget.bound("retainedBytes", stack.length * 32);
    const frame = stack[stack.length - 1]!;
    const n = frame.node;
    if (!frame.opened) {
      frame.opened = true;
      if (n.kind === "text") {
        if (mode === "pretty") {
          budget.charge("work", n.data.length);
          if (rustWhitespaceOnly(n.data)) { stack.pop(); continue; }
          if (previousWasBlock) yield "\n" + " ".repeat(indent);
          previousWasBlock = false;
        }
        if (n.parent?.namespace === "html" && rawElements.has(n.parent.name)) yield n.data;
        else yield* escaped(n.data, false);
        stack.pop();
        continue;
      }
      if (n.kind === "comment") {
        yield "<!--";
        yield n.data;
        yield "-->";
        stack.pop();
        continue;
      }
      if (n.kind === "doctype") {
        yield "<!DOCTYPE ";
        yield n.data;
        yield ">";
        stack.pop();
        continue;
      }
      if (n.kind === "element") {
        if (mode === "pretty") {
          if (!inlineElements.has(n.name) || previousWasBlock) yield "\n" + " ".repeat(indent);
          indent += 2;
        }
        yield "<";
        yield n.name;
        for (const a of n.attributes) {
          yield " ";
          yield a.name;
          yield '="';
          yield* escaped(a.value, true);
          yield '"';
        }
        yield ">";
        if (n.namespace === "html" && voidElements.has(n.name)) {
          if (mode === "pretty") {
            indent -= 2;
            previousWasBlock = !inlineElements.has(n.name);
            if (previousWasBlock) yield "\n" + " ".repeat(indent);
          }
          stack.pop();
          continue;
        }
      }
    }
    if (frame.child < n.children.length) {
      stack.push({ node: n.children[frame.child++]!, child: 0, opened: false });
      continue;
    }
    if (n.kind === "element") {
      if (mode === "pretty") {
        indent -= 2;
        previousWasBlock = !inlineElements.has(n.name);
        if (previousWasBlock) yield "\n" + " ".repeat(indent);
      }
      yield "</";
      yield n.name;
      yield ">";
    }
    stack.pop();
  }
}
export function serializeHtml(
  node: HtmlNode,
  options: HtmlOptions,
  mode: "normalized" | "original" | "pretty" = "normalized"
): string {
  const budget = new HtmlBudget(options);
  let out = "";
  for (const piece of pieces(node, budget, mode)) {
    budget.charge("work", piece.length);
    budget.charge("outputBytes", byteLength(piece));
    budget.charge("retainedBytes", piece.length * 2);
    out += piece;
  }
  return out;
}
export async function* serializeHtmlBytes(
  node: HtmlNode,
  options: HtmlOptions,
  mode: "normalized" | "original" | "pretty" = "normalized"
): AsyncGenerator<Uint8Array> {
  const budget = new HtmlBudget(options);
  const encoder = new TextEncoder();
  let pending = "";
  for (const piece of pieces(node, budget, mode)) {
    for (const c of piece) {
      budget.charge("work", 1);
      const length = byteLength(c);
      budget.charge("outputBytes", length);
      if (pending.length + c.length > 2048) {
        budget.bound("retainedBytes", 8192);
        budget.charge("retainedBytes", byteLength(pending));
        yield encoder.encode(pending);
        budget.check();
        pending = "";
      }
      budget.charge("retainedBytes", c.length * 2);
      pending += c;
    }
  }
  if (pending) {
    budget.bound("retainedBytes", pending.length * 6);
    budget.charge("retainedBytes", byteLength(pending));
    yield encoder.encode(pending);
    budget.check();
  }
}
export function htmlText(node: HtmlNode, options: HtmlOptions): string {
  const budget = new HtmlBudget(options);
  if (!ownsHtmlNode(node)) throw new HtmlError("E_OWNERSHIP", "Unowned HTML node");
  let out = "";
  const stack: { node: HtmlNode; child: number }[] = [{ node, child: 0 }];
  while (stack.length) {
    budget.charge("work", 1);
    budget.bound("depth", stack.length - 1);
    budget.bound("retainedBytes", stack.length * 32);
    const frame = stack[stack.length - 1]!;
    if (frame.node.kind === "text") {
      budget.charge("work", frame.node.data.length);
      budget.charge("outputBytes", byteLength(frame.node.data));
      budget.charge("retainedBytes", frame.node.data.length * 2);
      out += frame.node.data;
      stack.pop();
      continue;
    }
    if (frame.child < frame.node.children.length)
      stack.push({ node: frame.node.children[frame.child++]!, child: 0 });
    else stack.pop();
  }
  return out;
}
