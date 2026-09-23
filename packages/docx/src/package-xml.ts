import { parseXmlSteps, XmlLimitError, type XmlElement, type XmlLimits } from "@poe-code/safe-fs/xml";
import { CancellationError, InputTypeError, InvalidValueError, ResourceLimitError } from "./archive.js";
import { documentXmlCache, DocumentBudget, reservedWorkTurn } from "./budget.js";
import { parseMediaType } from "./media-type.js";
import { DocumentError } from "./document-error.js";
export type { XmlElement, XmlContent, XmlAttribute } from "@poe-code/safe-fs/xml";

/** Internal XML part classification; MIME spelling remains in package metadata. */
export function isXmlContentType(contentType: string): boolean {
  const type = parseMediaType(contentType);
  return type === "application/xml" || type === "text/xml" || type.endsWith("+xml");
}

export class InvalidPackageError extends DocumentError {
  constructor(message: string, readonly part?: string, readonly location = "/", readonly diagnosticCode = "package-structure") {
    super(message);
  }
}
export class InvalidXmlError extends DocumentError {
  override readonly code = "invalid-xml";
}

export class UnsupportedProfileError extends DocumentError {
  override readonly code = "unsupported-profile";
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
    maxAttributesPerElement: Infinity,
    maxNamespaces: Infinity,
    maxTextLength: budget.limits.xmlPartBytes,
    maxWork: budget.limits.work
  };
  for (const [key, value] of Object.entries(options)) {
    if (!Object.hasOwn(limits, key)) throw new InvalidValueError("Unknown XML limit.");
    if (value === undefined) continue;
    if (typeof value !== "number" || (value !== Infinity && !Number.isSafeInteger(value)) || value < 1)
      throw new InvalidValueError("XML limits must be positive safe integers.");
    limits[key as keyof typeof limits] = value;
  }
  return limits;
}

interface XmlParseReservations { xmlNodes: number; work: number; retainedBytes: number }

function* documentXmlSteps(input: Uint8Array, options: DocumentXmlLimits, budget: DocumentBudget, reservations: XmlParseReservations): Generator<number, DocumentXml> {
  if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected XML bytes.");
  const limits = documentXmlSettings(options, budget);
  if (input.byteLength > limits.maxBytes || input.byteLength > limits.maxWork)
    throw new ResourceLimitError("XML byte or work limit exceeded.");
  // Snapshot, decoded strings, parser tokens and namespace lookup storage.
  budget.charge("retainedBytes", input.byteLength * 16);
  reservations.retainedBytes += input.byteLength * 16;
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
    const parserLimits = { ...limits,
      maxNodes: Math.min(limits.maxNodes, remaining),
      maxContentNodes: Math.min(limits.maxContentNodes, remaining),
      maxAttributes: Math.min(limits.maxAttributes, remaining) };
    const parser = parseXmlSteps(chunks.join(""), { ...Object.fromEntries(Object.entries(parserLimits).filter(([, value]) => value !== Infinity)), expectedEncoding: encoding,
      onElement: () => { budget.charge("xmlNodes", 1); reservations.xmlNodes++; } });
    let work = bytes.length;
    try {
      while (true) {
        const result = parser.next();
        if (result.done) {
          const stack = [result.value];
          while (stack.length) {
            const element = stack.pop()!;
            budget.charge("xmlNodes", element.attributes.length);
            reservations.xmlNodes += element.attributes.length;
            for (const content of [element.content, element.prolog ?? [], element.epilog ?? []]) {
              for (const node of content) {
                if (++work > limits.maxWork) throw new ResourceLimitError("XML work limit exceeded.");
                if (node.kind === "element") stack.push(node);
                else { budget.charge("xmlNodes", 1); reservations.xmlNodes++; }
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

function cachedDocumentXml(input: Uint8Array, options: DocumentXmlLimits, budget: DocumentBudget, cooperative = false): { key?: string; maxNodes?: number; maxBytes?: number; document?: DocumentXml; staged?: boolean; replayWork?: number } {
  const entries = budget[documentXmlCache].entries;
  if (!entries) return {};
  if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected XML bytes.");
  const limits = documentXmlSettings(options, budget);
  budget.check("work", 0);
  if (input.length > limits.maxBytes || input.length > limits.maxWork)
    throw new ResourceLimitError("XML byte or work limit exceeded.");
  budget.charge("work", input.length);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) hash = Math.imul(hash ^ input[index]!, 16777619) >>> 0;
  // Validation has its own byte and remaining element ceilings. An immutable
  // full parse enforces them without reconstructing retained physical nodes.
  // All other limits remain exact, and differently bounded reads replay parsing.
  const key = `${JSON.stringify({ ...limits, maxNodes: 0, maxBytes: 0 })}:${input.length}:${hash}`;
  for (const candidate of entries.get(key) ?? []) {
    budget.charge("work", input.length * 2);
    let equal = candidate.document.bytes.length === candidate.source.length;
    for (let index = 0; equal && index < input.length; index++)
      equal = candidate.source[index] === input[index] && candidate.document.bytes[index] === candidate.source[index];
    if (equal) {
      if (candidate.elements > limits.maxNodes)
        throw new ResourceLimitError("XML structural or text limit exceeded.");
      const replay = candidate.replay ?? (candidate.maxNodes !== limits.maxNodes || candidate.maxBytes !== limits.maxBytes ? candidate.parseCost : undefined);
      if (replay) {
        budget.charge("retainedBytes", replay.retainedBytes);
        if (!cooperative) budget.charge("work", replay.work);
        budget.charge("xmlNodes", replay.xmlNodes);
      }
      return { key, document: candidate.document, ...(cooperative && replay ? { replayWork: replay.work } : {}) };
    }
  }
  if (budget[documentXmlCache].staged?.has(input)) return { key, maxNodes: limits.maxNodes, maxBytes: limits.maxBytes, staged: true };
  return budget[documentXmlCache].admitted?.has(input) ? { key, maxNodes: limits.maxNodes, maxBytes: limits.maxBytes } : {};
}

function retainDocumentXml(key: string | undefined, document: DocumentXml, budget: DocumentBudget, reservations: XmlParseReservations, maxNodes?: number, maxBytes?: number, staged = false): DocumentXml {
  if (key !== undefined) {
    // Cooperative host callbacks can reserve their own resources while parsing.
    // They belong to the host, not to a later replay of this immutable tree.
    const beforeRetention = budget.usage;
    const parseCost = Object.freeze({ ...reservations });
    const entries = budget[documentXmlCache].entries!;
    budget.charge("retainedBytes", key.length * 2 + 136 + document.bytes.length);
    budget.charge("work", document.bytes.length);
    const namespaces = new Map<ReadonlyMap<string, string>, ReadonlyMap<string, string>>();
    const pending: import("@poe-code/safe-fs/xml").XmlContent[] = [document.root];
    let elements = 0;
    while (pending.length) {
      const node = pending.pop()!;
      budget.charge("work", 1);
      if (node.kind === "element") {
        elements++;
        let view = namespaces.get(node.namespaces);
        if (!view) {
          budget.charge("retainedBytes", 128 + node.namespaces.size * 64);
          const owned = Object.freeze(new Map(node.namespaces));
          view = new Proxy(owned, {
            get(target, name, receiver) {
              if (name === "set" || name === "delete" || name === "clear") return undefined;
              if (name === "size") return target.size;
              if (name === "forEach") return (callback: (value: string, key: string, map: ReadonlyMap<string, string>) => void, thisArg?: unknown) => {
                if (typeof callback !== "function") throw new InputTypeError("Expected a namespace callback.");
                for (const [prefix, uri] of target) callback.call(thisArg, uri, prefix, receiver);
              };
              if (["get", "has", "keys", "values", "entries", Symbol.iterator].includes(name))
                return Reflect.get(target, name, target).bind(target);
              return Reflect.get(target, name, receiver);
            }
          });
          namespaces.set(node.namespaces, view);
        }
        Object.defineProperty(node, "namespaces", { value: view });
        for (const attribute of node.attributes) Object.freeze(attribute);
        for (const list of [node.content, node.children, node.attributes, node.prolog ?? [], node.epilog ?? []]) Object.freeze(list);
        budget.charge("retainedBytes", (node.content.length + (node.prolog?.length ?? 0) + (node.epilog?.length ?? 0)) * 8);
        for (const list of [node.content, node.prolog ?? [], node.epilog ?? []])
          for (const child of list) pending.push(child);
      }
      Object.freeze(node);
    }
    Object.freeze(document);
    budget.charge("retainedBytes", 64);
    (budget[documentXmlCache].immutableRoots ??= new WeakSet()).add(document.root);
    const bucket = entries.get(key) ?? [];
    const usage = budget.usage;
    bucket.push({ document, source: new Uint8Array(document.bytes), maxNodes: maxNodes!, maxBytes: maxBytes!, elements, parseCost, ...(staged ? { replay: {
      xmlNodes: parseCost.xmlNodes + usage.xmlNodes - beforeRetention.xmlNodes,
      work: parseCost.work + usage.work - beforeRetention.work,
      retainedBytes: parseCost.retainedBytes + usage.retainedBytes - beforeRetention.retainedBytes
    } } : {}) });
    entries.set(key, bucket);
  }
  return document;
}

export function parseDocumentXml(input: Uint8Array, options: DocumentXmlLimits = {}, budget = new DocumentBudget()): DocumentXml {
  const cached = cachedDocumentXml(input, options, budget);
  if (cached.document) return cached.document;
  const reservations = { xmlNodes: 0, work: 0, retainedBytes: 0 };
  const parser = documentXmlSteps(input, options, budget, reservations);
  try {
    while (true) {
      const step = parser.next();
      if (step.done) return retainDocumentXml(cached.key, step.value, budget, reservations, cached.maxNodes, cached.maxBytes, cached.staged);
      budget.charge("work", step.value);
      reservations.work += step.value;
    }
  } finally { parser.return(undefined as never); }
}

export async function parseDocumentXmlAsync(input: Uint8Array, options: DocumentXmlLimits = {}, budget = new DocumentBudget()): Promise<DocumentXml> {
  const cached = cachedDocumentXml(input, options, budget, true);
  if (cached.document) {
    if (cached.replayWork !== undefined) await budget.checkpoint(cached.replayWork);
    return cached.document;
  }
  const reservations = { xmlNodes: 0, work: 0, retainedBytes: 0 };
  const parser = documentXmlSteps(input, options, budget, reservations);
  try {
    while (true) {
      const step = parser.next();
      if (step.done) return retainDocumentXml(cached.key, step.value, budget, reservations, cached.maxNodes, cached.maxBytes, cached.staged);
      budget.charge("work", step.value);
      const pending = budget[reservedWorkTurn](step.value);
      if (pending) await pending;
      reservations.work += step.value;
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
