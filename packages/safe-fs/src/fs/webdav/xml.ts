import { parseXmlSteps as parseDocumentSteps, XmlLimitError, type XmlLimits as DocumentLimits } from "../../xml.js";
import type { XmlElement } from "../../xml.js";
export type { XmlElement } from "../../xml.js";
export interface XmlLimits extends Omit<DocumentLimits, "onElement"> { readonly maxResponses?: number; }
export class XmlResponseLimitError extends SyntaxError {}
export class XmlResourceLimitError extends SyntaxError {}
function invalid(message: string): never { throw new SyntaxError(`Invalid WebDAV XML: ${message}`); }

export function parseXml(input: string, limits: XmlLimits = {}): XmlElement {
  const parser = parseXmlSteps(input, limits);
  try {
    let step = parser.next();
    while (!step.done) step = parser.next();
    return step.value;
  } catch (error) {
    if (error instanceof XmlResourceLimitError) throw new SyntaxError(error.message);
    throw error;
  }
}

export function* parseXmlSteps(input: string, limits: XmlLimits = {}): Generator<number, XmlElement, void> {
  const { maxResponses, ...documentLimits } = limits;
  if (maxResponses !== undefined && (!Number.isSafeInteger(maxResponses) || maxResponses < 1)) {
    throw new RangeError("XML limits must be positive integers");
  }
  let responses = 0;
  try {
    return yield* parseDocumentSteps(input, { ...documentLimits, retainContent: false,
      onElement(element, parent, depth) {
        if (maxResponses !== undefined && depth === 2 && parent?.namespace === "DAV:" && parent.localName === "multistatus"
          && element.namespace === "DAV:" && element.localName === "response" && ++responses > maxResponses) {
          throw new XmlResponseLimitError("WebDAV XML response limit exceeded");
        }
      }
    });
  } catch (error) {
    if (error instanceof XmlLimitError) throw new XmlResourceLimitError(`Invalid WebDAV XML: ${error.message}`);
    if (error instanceof SyntaxError && error.message.startsWith("Invalid XML:")) {
      error.message = error.message.replace("Invalid XML:", "Invalid WebDAV XML:");
    }
    throw error;
  }
}

export function davChildren(element: XmlElement, localName: string): XmlElement[] {
  return element.children.filter((child) => child.namespace === "DAV:" && child.localName === localName);
}

export function davChild(element: XmlElement, localName: string): XmlElement | undefined {
  const children = davChildren(element, localName);
  if (children.length > 1) invalid(`duplicate DAV:${localName}`);
  return children[0];
}

export function scalar(element: XmlElement): string {
  if (element.children.length) invalid("expected text-only element");
  return element.text.trim();
}
