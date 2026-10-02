import { InvalidPackageError, type XmlElement } from "./package-xml.js";
import { trimXmlWhitespace } from "./stored-lexical.js";

/** Decode native grid metadata; absent properties retain their distinct defaults. */
export function tableGridCount(node: XmlElement | undefined, fallback: number): number {
  if (!node) return fallback;
  const raw = node.attributes.find(a => a.namespace === node.namespace && a.localName === "val")?.value;
  const value = raw === undefined ? "" : trimXmlWhitespace(raw);
  const digits = value[0] === "+" || value[0] === "-" ? value.slice(1) : value;
  const count = Number(value), minimum = node.localName === "gridSpan" ? 1 : 0;
  if (!digits || [...digits].some(c => c < "0" || c > "9") || !Number.isSafeInteger(count) || count < minimum)
    throw new InvalidPackageError("Invalid table grid count.");
  return count === 0 ? 0 : count;
}
