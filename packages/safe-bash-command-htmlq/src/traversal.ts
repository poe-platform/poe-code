import { HtmlBudget, HtmlError, type HtmlNode, type HtmlOptions } from "./contracts.js";
import { ownsHtmlNode } from "./tree.js";
/** Inclusive, live traversal with the next edge queued before yielding, like kuchikiki. */
export function* inclusiveHtmlDescendants(
  root: HtmlNode,
  options: HtmlOptions
): Generator<HtmlNode> {
  const budget = new HtmlBudget(options);
  if (!ownsHtmlNode(root)) throw new HtmlError("E_OWNERSHIP", "Unowned HTML node");
  let node: HtmlNode | null = root;
  let start = true;
  let depth = 0;
  while (node) {
    budget.charge("work", 1);
    budget.bound("depth", depth);
    const current: HtmlNode = node;
    const entering = start;
    if (start) {
      if (current.children.length) {
        node = current.children[0]!;
        depth++;
      } else start = false;
    } else {
      if (current === root) return;
      if (current.nextSibling) {
        node = current.nextSibling;
        start = true;
      } else {
        node = current.parent;
        depth = Math.max(0, depth - 1);
      }
    }
    if (entering) yield current;
  }
}
