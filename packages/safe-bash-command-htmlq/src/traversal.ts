import { HtmlBudget, HtmlError, type HtmlNode, type HtmlOptions } from "./contracts.js";
import { getInternalHtmlNode, getPublicHtmlView, type FastMutableNode } from "./tree.js";
/** Inclusive, live traversal with the next edge queued before yielding, like kuchikiki. */
export function* inclusiveHtmlDescendants(
  root: HtmlNode,
  options: HtmlOptions
): Generator<HtmlNode> {
  const budget = new HtmlBudget(options);
  const internalRoot = getInternalHtmlNode(root);
  if (!internalRoot) throw new HtmlError("E_OWNERSHIP", "Unowned HTML node");
  let node: FastMutableNode | null = internalRoot;
  let start = true;
  let depth = 0;
  while (node) {
    budget.charge("work", 1);
    budget.bound("depth", depth);
    const current: FastMutableNode = node;
    const entering = start;
    if (start) {
      if (current.children.length) {
        node = current.children[0]! as FastMutableNode;
        depth++;
      } else start = false;
    } else {
      if (current === internalRoot) return;
      if (current.nextSibling) {
        node = current.nextSibling as FastMutableNode;
        start = true;
      } else {
        node = current.parent as FastMutableNode | null;
        depth = Math.max(0, depth - 1);
      }
    }
    if (entering) yield getPublicHtmlView(current);
  }
}
