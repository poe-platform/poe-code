import { parseXmlSteps, XmlLimitError, type XmlElement, type XmlLimits } from "@poe-code/safe-fs/xml";
import { CancellationError, InputTypeError, InvalidValueError, ResourceLimitError } from "./archive.js";
import { DocumentBudget } from "./budget.js";
export type { XmlElement, XmlContent, XmlAttribute } from "@poe-code/safe-fs/xml";

export class InvalidPackageError extends Error {
  readonly code = "invalid-package";
  constructor(message: string, readonly part?: string, readonly location = "/", readonly diagnosticCode = "package-structure") {
    super(message);
  }
}
export class InvalidXmlError extends Error {
  readonly code = "invalid-xml";
}

export class UnsupportedProfileError extends Error {
  readonly code = "unsupported-profile";
}

export interface DocumentXmlLimits extends Pick<XmlLimits,
  "maxDepth" | "maxNodes" | "maxAttributes" | "maxAttributesPerElement" |
  "maxNamespaces" | "maxContentNodes" | "maxTextLength"> {
  readonly maxBytes?: number;
  readonly maxWork?: number;
}

export interface DocumentXml {
  readonly bytes: Uint8Array;
  readonly encoding: "UTF-8" | "UTF-16LE" | "UTF-16BE";
  readonly bom: boolean;
  readonly root: XmlElement;
}

export function documentXmlSettings(options: DocumentXmlLimits, budget = new DocumentBudget()) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new InvalidValueError("Expected an XML limits object.");
  const limits = {
    maxBytes: budget.limits.xmlPartBytes,
    maxDepth: budget.limits.xmlDepth,
    maxNodes: budget.limits.xmlNodes,
    maxContentNodes: budget.limits.xmlNodes,
    maxAttributes: budget.limits.xmlNodes,
    maxAttributesPerElement: 128,
    maxNamespaces: 256,
    maxTextLength: budget.limits.xmlPartBytes,
    maxWork: budget.limits.work
  };
  for (const [key, value] of Object.entries(options)) {
    if (!Object.hasOwn(limits, key)) throw new InvalidValueError("Unknown XML limit.");
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > limits[key as keyof typeof limits])
      throw new InvalidValueError("XML limits must be positive safe integers.");
    limits[key as keyof typeof limits] = value;
  }
  return limits;
}

function* documentXmlSteps(input: Uint8Array, options: DocumentXmlLimits, budget: DocumentBudget): Generator<number, DocumentXml> {
  if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected XML bytes.");
  const limits = documentXmlSettings(options, budget);
  if (input.byteLength > limits.maxBytes || input.byteLength > limits.maxWork)
    throw new ResourceLimitError("XML byte or work limit exceeded.");
  // Snapshot, decoded strings, parser tokens and namespace lookup storage.
  budget.charge("retainedBytes", input.byteLength * 16);
  const bytes = new Uint8Array(input);
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "UTF-16LE"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "UTF-16BE" : "UTF-8";
  const bom = encoding !== "UTF-8" || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
  try {
    const decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      yield Math.min(4096, bytes.length - offset);
      chunks.push(decoder.decode(bytes.subarray(offset, offset + 4096), { stream: true }));
    }
    chunks.push(decoder.decode());
    const remaining = budget.limits.xmlNodes - budget.usage.xmlNodes;
    if (remaining < 1) throw new ResourceLimitError("XML node limit exceeded.");
    const parser = parseXmlSteps(chunks.join(""), { ...limits, expectedEncoding: encoding,
      maxNodes: Math.min(limits.maxNodes, remaining),
      maxContentNodes: Math.min(limits.maxContentNodes, remaining),
      maxAttributes: Math.min(limits.maxAttributes, remaining),
      onElement: () => budget.charge("xmlNodes", 1) });
    let work = bytes.length;
    try {
      while (true) {
        const result = parser.next();
        if (result.done) {
          const stack = [result.value];
          while (stack.length) {
            const element = stack.pop()!;
            budget.charge("xmlNodes", element.attributes.length);
            for (const content of [element.content, element.prolog ?? [], element.epilog ?? []]) {
              for (const node of content) {
                if (++work > limits.maxWork) throw new ResourceLimitError("XML work limit exceeded.");
                if (node.kind === "element") stack.push(node);
                else budget.charge("xmlNodes", 1);
                yield 1;
              }
            }
          }
          return { bytes, encoding, bom, root: result.value };
        }
        if (result.value > limits.maxWork - work) throw new ResourceLimitError("XML work limit exceeded.");
        work += result.value;
        yield result.value;
      }
    } finally { parser.return(undefined as never); }
  } catch (error) {
    if (error instanceof ResourceLimitError || error instanceof CancellationError) throw error;
    if (error instanceof XmlLimitError) throw new ResourceLimitError("XML structural or text limit exceeded.");
    throw new InvalidXmlError("Malformed, unsupported encoding or prohibited document XML.");
  }
}

export function parseDocumentXml(input: Uint8Array, options: DocumentXmlLimits = {}, budget = new DocumentBudget()): DocumentXml {
  const parser = documentXmlSteps(input, options, budget);
  try {
    while (true) {
      const step = parser.next();
      if (step.done) return step.value;
      budget.charge("work", step.value);
    }
  } finally { parser.return(undefined as never); }
}

export async function parseDocumentXmlAsync(input: Uint8Array, options: DocumentXmlLimits = {}, budget = new DocumentBudget()): Promise<DocumentXml> {
  const parser = documentXmlSteps(input, options, budget);
  try {
    while (true) {
      const step = parser.next();
      if (step.done) return step.value;
      await budget.checkpoint(step.value);
    }
  } finally { parser.return(undefined as never); }
}

export function xml(
  bytes: Uint8Array,
  visit: (tag: XmlElement, depth: number) => void,
  elementOnly = false,
  budget = new DocumentBudget(),
  parsed?: XmlElement
): void {
  const root = parsed ?? parseDocumentXml(bytes, {}, budget).root;
  const stack = [{ tag: root, depth: 1 }];
  while (stack.length) {
    budget.charge("work", 1);
    const { tag, depth } = stack.pop()!;
    if (elementOnly) {
      for (const char of tag.text) {
        if (!" \t\r\n".includes(char))
          throw new InvalidPackageError("Unexpected package metadata text.");
      }
    }
    visit(tag, depth);
    for (let index = tag.children.length - 1; index >= 0; index--)
      stack.push({ tag: tag.children[index]!, depth: depth + 1 });
  }
}
