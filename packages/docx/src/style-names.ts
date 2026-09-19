import type { XmlElement } from "./package-xml.js";
import type { DocumentBudget } from "./budget.js";

/** Built-in display names whose stored WordprocessingML names differ. */
const displayNames = ["Caption", "Header", "Footer", "Heading 1", "Heading 2", "Heading 3", "Heading 4", "Heading 5", "Heading 6", "Heading 7", "Heading 8", "Heading 9"];
export function styleDisplayName(name: string, builtin = true): string {
  return builtin ? displayNames.find(value => value.toLowerCase() === name) ?? name : name;
}
export function styleStoredName(name: string, builtin = true): string {
  return builtin && displayNames.includes(name) ? name.toLowerCase() : name;
}

/** Exact public names take precedence; only built-in definitions have stored aliases. */
export function selectNamedStyles(nodes: readonly XmlElement[], name: string, children: (node: XmlElement) => readonly XmlElement[], budget: DocumentBudget): XmlElement[] {
  const entries = nodes.map(node => {
    const fields = children(node), definition = fields.find(child => child.namespace === node.namespace && child.localName === "name");
    budget.charge("work", 1 + node.attributes.length + fields.length + (definition?.attributes.length ?? 0));
    const stored = definition?.attributes.find(attribute => attribute.namespace === node.namespace && attribute.localName === "val")?.value;
    const builtin = !["1", "true", "on"].includes(node.attributes.find(attribute => attribute.namespace === node.namespace && attribute.localName === "customStyle")?.value ?? "0");
    return { node, stored, builtin, displayed: stored === undefined ? undefined : styleDisplayName(stored, builtin) };
  });
  const exact = entries.filter(entry => entry.displayed === name);
  return (exact.length ? exact : entries.filter(entry => entry.builtin && entry.stored !== undefined && styleStoredName(entry.stored) === styleStoredName(name))).map(entry => entry.node);
}
