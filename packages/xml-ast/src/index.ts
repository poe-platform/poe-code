import { XmlFrames, type XmlFrameRequest, type XmlParserFrame } from "./frames.js";
export type { XmlParserFrame, XmlFrameRequest } from "./frames.js";
import { validCharacter } from "./characters.js";
export { normalizeXmlChunks } from "./characters.js";
import { XmlSource, type XmlSourceStep } from "./source.js";
export type { XmlSourceRead, XmlSourceStep } from "./source.js";
import type { XmlStreamEvent } from "./stream.js";
import { XmlLimitError } from "./errors.js";
export { XmlLimitError } from "./errors.js";

export interface XmlName {
  readonly name: string;
  readonly namespace: string;
  readonly localName: string;
}
export interface XmlAttribute extends XmlName { readonly value: string; }
export type XmlContent = XmlElement | { readonly kind: "text" | "cdata" | "comment"; readonly text: string }
  | { readonly kind: "processing-instruction"; readonly target: string; readonly text: string };
export interface XmlElement extends XmlName {
  readonly kind: "element";
  readonly children: XmlElement[];
  readonly content: readonly XmlContent[];
  readonly attributes: readonly XmlAttribute[];
  readonly namespaces: ReadonlyMap<string, string>;
  text: string;
  readonly declaration?: string;
  readonly prolog?: readonly XmlContent[];
  readonly epilog?: readonly XmlContent[];
}
export interface XmlLimits {
  /** Opt-in best-effort parsing; each repaired syntax error is reported. DTDs remain forbidden. */
  readonly recover?: (message: string) => void;
  readonly expectedEncoding?: "UTF-8" | "UTF-16" | "UTF-16LE" | "UTF-16BE";
  readonly retainContent?: boolean;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxAttributes?: number;
  readonly maxAttributesPerElement?: number;
  readonly maxNamespaces?: number;
  readonly maxContentNodes?: number;
  readonly maxTextLength?: number;
  readonly onElement?: (element: XmlName, parent: XmlName | undefined, depth: number) => void;
}

function find(source: string, needle: string, start: number): Generator<number, number, void>;
function find(source: XmlSource, needle: string, start: number): Generator<XmlSourceStep, number, void>;
function* find(source: string | XmlSource, needle: string, start: number): Generator<XmlSourceStep, number, void> {
  const found = typeof source === "string" ? source.indexOf(needle, start) : yield* source.indexOf(needle, start);
  const end = found < 0 ? source.length : found;
  let remaining = end - start;
  while (remaining >= 512) { yield 512; remaining -= 512; }
  if (remaining > 0) yield remaining;
  return found;
}

const xmlNamespace = "http://www.w3.org/XML/1998/namespace";
const xmlnsNamespace = "http://www.w3.org/2000/xmlns/";

function invalid(message: string): never {
  throw new SyntaxError(`Invalid XML: ${message}`);
}

function nameStart(point: number): boolean {
  return point === 95 || (point >= 65 && point <= 90) || (point >= 97 && point <= 122)
    || (point >= 0xc0 && point <= 0xd6) || (point >= 0xd8 && point <= 0xf6)
    || (point >= 0xf8 && point <= 0x2ff) || (point >= 0x370 && point <= 0x37d)
    || (point >= 0x37f && point <= 0x1fff) || (point >= 0x200c && point <= 0x200d)
    || (point >= 0x2070 && point <= 0x218f) || (point >= 0x2c00 && point <= 0x2fef)
    || (point >= 0x3001 && point <= 0xd7ff) || (point >= 0xf900 && point <= 0xfdcf)
    || (point >= 0xfdf0 && point <= 0xfffd) || (point >= 0x10000 && point <= 0xeffff);
}

function namePart(point: number): boolean {
  return nameStart(point) || point === 45 || point === 46 || point === 0xb7
    || (point >= 48 && point <= 57) || (point >= 0x300 && point <= 0x36f)
    || (point >= 0x203f && point <= 0x2040);
}

interface QualifiedNameCache {
  name: string | undefined;
  parts: [string, string] | undefined;
}

function qualifiedNameSync(name: string, cache: QualifiedNameCache): [string, string] {
  if (cache.name === name) return cache.parts!;
  let prefix = "";
  let start = 0;
  let first = true;
  for (let offset = 0; offset < name.length;) {
    const point = name.codePointAt(offset)!;
    if (point === 58) {
      if (start !== 0 || first) invalid("invalid qualified name");
      prefix = name.slice(0, offset);
      start = offset + 1;
      first = true;
    } else {
      if (!(first ? nameStart(point) : namePart(point))) invalid("invalid qualified name");
      first = false;
    }
    offset += point > 0xffff ? 2 : 1;
  }
  if (first) invalid("invalid qualified name");
  const parts: [string, string] = [prefix, name.slice(start)];
  // Retain only one short name; namespace resolution still happens per element.
  if (name.length <= 512) {
    cache.name = name;
    cache.parts = parts;
  }
  return parts;
}

function entity(source: string, start: number, end: number, recover?: (message: string) => void): Generator<number, string, void>;
function entity(source: XmlSource, start: number, end: number, recover?: (message: string) => void): Generator<XmlSourceStep, string, void>;
function* entity(source: string | XmlSource, start: number, end: number, recover?: (message: string) => void): Generator<XmlSourceStep, string, void> {
  // Inspect only a bounded prefix, even for arbitrarily long numeric references.
  const prefix = typeof source === "string" ? source.slice(start, Math.min(end, start + 4))
    : yield* source.slice(start, Math.min(end, start + 4));
  const predefined: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  if (end - start <= 4 && Object.hasOwn(predefined, prefix)) return predefined[prefix]!;
  const hexadecimal = prefix.startsWith("#x"), digits = start + (hexadecimal ? 2 : 1);
  if (!prefix.startsWith("#") || digits >= end) {
    if (!recover) invalid("undeclared entity");
    recover("undeclared entity");
    return "";
  }
  let point = 0;
  for (let index = digits; index < end; index++) {
    const code = typeof source === "string" ? source.charCodeAt(index) : yield* source.charCodeAt(index);
    const digit = code >= 48 && code <= 57 ? code - 48 : hexadecimal && code >= 65 && code <= 70 ? code - 55
      : hexadecimal && code >= 97 && code <= 102 ? code - 87 : -1;
    if (digit < 0) invalid("undeclared entity");
    point = point * (hexadecimal ? 16 : 10) + digit;
    if (point > 0x10ffff) invalid("invalid character reference");
    if ((index - digits + 1) % 512 === 0) yield 512;
  }
  if ((end - digits) % 512) yield (end - digits) % 512;
  if (!validCharacter(point)) invalid("invalid character reference");
  return String.fromCodePoint(point);
}

/** Decoded text fragments; source read/work requests remain host-serviced. */
function* textParts(source: XmlSource, start: number, end: number, decode: boolean,
  recover?: (message: string) => void): Generator<XmlSourceStep | string, void, void> {
  let cursor = start;
  while (cursor < end) {
    let finish = Math.min(end, cursor + 512);
    if (finish < end) {
      const last = yield* source.charCodeAt(finish - 1);
      if (last >= 0xd800 && last <= 0xdbff) finish--;
    }
    const raw = yield* source.slice(cursor, finish);
    const found = decode ? raw.indexOf("&") : -1;
    if (found < 0) {
      yield raw;
      yield raw.length;
      cursor = finish;
      continue;
    }
    const amp = cursor + found;
    if (found) { yield raw.slice(0, found); yield found; }
    const semicolon = yield* source.indexOf(";", amp + 1, end);
    if (semicolon < 0) {
      if (!recover) invalid("unterminated entity");
      recover("unterminated entity");
      cursor = amp + 1;
      decode = false;
      continue;
    }
    const part = yield* entity(source, amp + 1, semicolon, recover);
    if (part) yield part;
    yield 1;
    cursor = semicolon + 1;
  }
}

function* textFragments(source: XmlSource, start: number, end: number, decode: boolean,
  recover?: (message: string) => void): Generator<XmlSourceStep | string, void, void> {
  let pending = "";
  for (const part of textParts(source, start, end, decode, recover)) {
    if (typeof part !== "string") { yield part; continue; }
    pending += part;
    while (pending.length >= 512) {
      const last = pending.charCodeAt(511), width = last >= 0xd800 && last <= 0xdbff ? 511 : 512;
      yield pending.slice(0, width);
      pending = pending.slice(width);
    }
  }
  if (pending) yield pending;
}

function* entities(text: string, recover?: (message: string) => void): Generator<number, string, void> {
  let result = "";
  let offset = 0;
  while (offset < text.length) {
    const start = yield* find(text, "&", offset);
    if (start < 0) return result + text.slice(offset);
    result += text.slice(offset, start);
    const end = yield* find(text, ";", start + 1);
    if (end < 0) {
      if (!recover) invalid("unterminated entity");
      recover("unterminated entity");
      return result + text.slice(start + 1);
    }
    result += yield* entity(text, start + 1, end, recover);
    offset = end + 1;
  }
  return result;
}

function* validDeclaration(content: string, expectedEncoding: XmlLimits["expectedEncoding"]): Generator<number, boolean, void> {
  let offset = 0;
  const whitespace = function* (): Generator<number, number, void> {
    const start = offset;
    while (offset < content.length && " \t\n\r".includes(content[offset]!)) {
      offset++;
      if ((offset - start) % 512 === 0) yield 512;
    }
    if ((offset - start) % 512) yield (offset - start) % 512;
    return offset - start;
  };
  const field = function* (name: string): Generator<number, string | undefined, void> {
    if (content.slice(offset, offset + name.length) !== name) return undefined;
    offset += name.length;
    yield name.length;
    yield* whitespace();
    if (content[offset++] !== "=") return undefined;
    yield* whitespace();
    const quote = content[offset++];
    if (quote !== "'" && quote !== '"') return undefined;
    const start = offset;
    while (offset < content.length && content[offset] !== quote) {
      offset++;
      if ((offset - start) % 512 === 0) yield 512;
    }
    if ((offset - start) % 512) yield (offset - start) % 512;
    if (offset >= content.length) return undefined;
    return content.slice(start, offset++);
  };
  if (!(yield* whitespace()) || (yield* field("version")) !== "1.0") return false;
  let spacing = yield* whitespace();
  if (content.slice(offset, offset + 8) === "encoding") {
    if (!spacing) return false;
    const encoding = yield* field("encoding");
    if (encoding === undefined || encoding.length > 8 || !["utf-8", "utf-16", "utf-16le", "utf-16be"].includes(encoding.toLowerCase())) return false;
    if (expectedEncoding !== undefined && encoding.toLowerCase() !== expectedEncoding.toLowerCase()
      && !(encoding.toLowerCase() === "utf-16" && (expectedEncoding === "UTF-16LE" || expectedEncoding === "UTF-16BE"))) return false;
    spacing = yield* whitespace();
  }
  if (content.slice(offset, offset + 10) === "standalone") {
    if (!spacing) return false;
    const standalone = yield* field("standalone");
    if (standalone === undefined || standalone.length > 3 || !["yes", "no"].includes(standalone)) return false;
    yield* whitespace();
  }
  return offset === content.length;
}

export interface XmlStepLimits extends XmlLimits {
  /** Return root metadata without retaining descendants or text. */
  readonly retainTree?: boolean;
  /** Synchronous ordered events, including repaired closes. Requires retainTree:
   * false. Drive the step iterator to await external consumers between windows. */
  readonly events?: (event: XmlStreamEvent) => void;
}

function validateLimits(limits: XmlStepLimits): void {
  for (const limit of [limits.maxDepth, limits.maxNodes, limits.maxAttributes, limits.maxContentNodes, limits.maxAttributesPerElement, limits.maxNamespaces]) {
    if (limit !== undefined && ((limit !== Infinity && !Number.isSafeInteger(limit)) || limit < 1)) throw new RangeError("XML limits must be positive integers");
  }
  if (limits.maxTextLength !== undefined && ((limits.maxTextLength !== Infinity && !Number.isSafeInteger(limits.maxTextLength)) || limits.maxTextLength < 1)) throw new RangeError("XML limits must be positive integers");
  if (limits.events && limits.retainTree !== false) throw new TypeError("XML events require retainTree: false");
}

export interface XmlSourceLimits extends XmlStepLimits {
  /** Emit content bodies in bounded fragments, marking continuations of the same logical
   * node. Requires retainTree: false; consumers must preserve fragment identity. */
  readonly fragmentContent?: boolean;
  /** Store active parser frames through host-serviced requests. Requires retainTree: false. */
  readonly storeFrames?: boolean;
}
export type XmlParseStep = XmlSourceStep | XmlFrameRequest;

/** Parse a validated, BOM-free, line-normalized UTF-16 source via bounded read requests. */
export function parseXmlSourceSteps(length: number | undefined, limits?: XmlStepLimits & { readonly storeFrames?: false }): Generator<XmlSourceStep, XmlElement, void>;
export function parseXmlSourceSteps(length: number | undefined, limits: XmlSourceLimits): Generator<XmlParseStep, XmlElement, void>;
export function* parseXmlSourceSteps(length: number | undefined, limits: XmlSourceLimits = {}): Generator<XmlParseStep, XmlElement, void> {
  validateLimits(limits);
  if (limits.storeFrames && limits.retainTree !== false) throw new TypeError("Stored XML frames require retainTree: false");
  if (limits.fragmentContent && limits.retainTree !== false) throw new TypeError("XML content fragments require retainTree: false");
  const source = new XmlSource(length);
  const maxDepth = limits.maxDepth ?? Infinity;
  const maxNodes = limits.maxNodes ?? Infinity;
  const maxAttributes = limits.maxAttributes ?? Infinity;
  const retainContent = limits.retainContent !== false;
  const retainTree = limits.retainTree !== false;
  const retain = retainTree && retainContent;
  const maxContentNodes = limits.maxContentNodes ?? Infinity;
  const emptyContent: readonly XmlContent[] = Object.freeze([]);
  const emptyAttributes: readonly XmlAttribute[] = Object.freeze([]);
  const emptyNamespaces: ReadonlyMap<string, string> = new Map();
  const maxAttributesPerElement = limits.maxAttributesPerElement ?? Infinity;
  const maxNamespaces = limits.maxNamespaces ?? Infinity;
  const maxTextLength = limits.maxTextLength ?? Infinity;
  let textLength = 0;
  const admitText = (text: string): void => {
    if (text.length > maxTextLength - textLength) throw new XmlLimitError("maxTextLength", "XML text limit exceeded");
    textLength += text.length;
  };
  const stack = new XmlFrames(limits.storeFrames === true);
  let root: XmlElement | undefined;
  const prolog: XmlContent[] = [];
  const epilog: XmlContent[] = [];
  let declaration: string | undefined;
  let offset = 0;
  let nodes = 0;
  let attributeCount = 0;
  let contentNodes = 0;
  let previousEmpty: { suffix: string; name: string; prefix: string; localName: string } | undefined;
  const qualifiedNames: QualifiedNameCache = { name: undefined, parts: undefined };
  const admitContent = (): void => {
    if (++contentNodes > maxContentNodes) throw new XmlLimitError("maxContentNodes", "XML content node limit exceeded");
  };
  let pendingWork = 0;
  const skipWhitespace = function* (): Generator<XmlSourceStep, number> {
    const start = offset;
    while (yield* source.has(offset)) {
      const c = (yield* source.charCodeAt(offset));
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break;
      offset++;
      pendingWork++;
      if (pendingWork >= 512) { yield 512; pendingWork -= 512; }
    }
    return offset - start;
  };
  const scanName = function* (): Generator<XmlSourceStep, [string, string, string]> {
    const start = offset;
    while (yield* source.has(offset)) {
      const c = (yield* source.charCodeAt(offset));
      if (c === 32 || c === 9 || c === 13 || c === 10 || c === 47 || c === 61 || c === 62 || c === 63) break;
      offset++;
      pendingWork++;
      if (pendingWork >= 512) { yield 512; pendingWork -= 512; }
    }
    const name = (yield* source.slice(start, offset));
    pendingWork += offset - start;
    while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
    const [prefix, localName] = qualifiedNameSync(name, qualifiedNames);
    return [name, prefix, localName];
  };
  const rawContent = function* (kind: "cdata" | "comment" | "processing-instruction", start: number, end: number,
    parent: XmlParserFrame | undefined, target = ""): Generator<XmlSourceStep, void, void> {
    if (end - start > maxTextLength - textLength) throw new XmlLimitError("maxTextLength", "XML text limit exceeded");
    textLength += end - start;
    admitContent();
    let cursor = start, continuation = false;
    do {
      let finish = limits.fragmentContent ? Math.min(end, cursor + 512) : end;
      if (finish < end) {
        const last = yield* source.charCodeAt(finish - 1);
        if (last >= 0xd800 && last <= 0xdbff) finish--;
      }
      const text = yield* source.slice(cursor, finish);
      const content: Exclude<XmlContent, XmlElement> = kind === "processing-instruction" ? { kind, target, text } : { kind, text };
      if (kind === "cdata" && retainTree) parent!.element.text += text;
      if (retain) (parent?.content ?? (root ? epilog : prolog)).push(content);
      limits.events?.({ type: "content", content, parent: parent?.element,
        ...(continuation ? { continuation: true } : {}) });
      if (limits.fragmentContent) yield Math.max(1, text.length);
      continuation = true;
      cursor = finish;
    } while (cursor < end);
  };
  while (yield* source.has(offset)) {
    pendingWork += 1;
    if (pendingWork >= 512) {
      while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
    }
    if ((yield* source.charCodeAt(offset)) !== 60) {
      const next = (yield* source.indexOf("<", offset));
      const endPos = next < 0 ? source.length : next;
      if (limits.fragmentContent) {
        if ((yield* source.indexOf("]]>", offset, endPos)) >= 0) invalid("CDATA terminator in text");
        const parent = yield* stack.peek();
        let size = 0, outsideText = false;
        // Validate before emitting any part of the logical node. This preserves
        // entity/recovery diagnostics and limit precedence without retaining it.
        for (const part of textFragments(source, offset, endPos, !!parent, limits.recover)) {
          if (typeof part !== "string") { yield part; continue; }
          size += part.length;
          if (!parent) for (const character of part) {
            if (!" \t\r\n".includes(character)) outsideText = true;
          }
        }
        if (size > maxTextLength - textLength) throw new XmlLimitError("maxTextLength", "XML text limit exceeded");
        textLength += size;
        if (outsideText) invalid("text outside the root");
        if (size) {
          admitContent();
          if (limits.events) {
            let continuation = false;
            for (const part of textFragments(source, offset, endPos, !!parent, limits.recover ? () => {} : undefined)) {
              if (typeof part !== "string") { yield part; continue; }
              limits.events({ type: "content", content: { kind: "text", text: part }, parent: parent?.element,
                ...(continuation ? { continuation: true } : {}) });
              continuation = true;
              yield 1;
            }
          }
        }
        offset = endPos;
        continue;
      }
      const text = (yield* source.slice(offset, endPos));
      pendingWork += (endPos - offset) + text.length;
      while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
      if (text.indexOf("]]>") >= 0) invalid("CDATA terminator in text");
      const resolved = stack.length ? (text.indexOf("&") < 0 ? (pendingWork += text.length, text) : yield* entities(text, limits.recover)) : text;
      while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
      admitText(resolved);
      const parent = (yield* stack.peek());
      if (parent) {
        if (retainTree) parent.element.text += resolved;
        if (resolved.length) {
          admitContent();
          if (retain) parent.content!.push({ kind: "text", text: resolved });
          limits.events?.({ type: "content", content: { kind: "text", text: resolved }, parent: parent.element });
        }
      } else {
        for (let index = 0; index < resolved.length; index++) {
          pendingWork++;
          if (pendingWork >= 512) { yield 512; pendingWork -= 512; }
          const c = resolved.charCodeAt(index);
          if (c !== 32 && c !== 9 && c !== 13 && c !== 10) invalid("text outside the root");
        }
        while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
        if (resolved.length) {
          admitContent();
          if (retain) (root ? epilog : prolog).push({ kind: "text", text: resolved });
          limits.events?.({ type: "content", content: { kind: "text", text: resolved }, parent: undefined });
        }
      }
      offset = endPos;
    } else if ((yield* source.startsWith("<!--", offset))) {
      const end = yield* find(source, "-->", offset + 4);
      if (end < 0 || (yield* source.indexOf("--", offset + 4, end)) >= 0
        || (end > offset + 4 && (yield* source.charCodeAt(end - 1)) === 45)) invalid("malformed comment");
      yield* rawContent("comment", offset + 4, end, yield* stack.peek());
      offset = end + 3;
    } else if ((yield* source.startsWith("<![CDATA[", offset))) {
      if (!stack.length) invalid("CDATA outside root");
      const end = yield* find(source, "]]>", offset + 9);
      if (end < 0) invalid("unterminated CDATA");
      yield* rawContent("cdata", offset + 9, end, yield* stack.peek());
      offset = end + 3;
    } else if ((yield* source.startsWith("<?", offset))) {
      const start = offset;
      offset += 2;
      const [target] = yield* scanName();
      while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
      const end = yield* find(source, "?>", offset);
      if (end < 0) invalid("unterminated processing instruction");
      if (target.length === 3 && target.toLowerCase() === "xml") {
        const content = yield* source.slice(offset, end);
        if (start !== 0 || target !== "xml"
          || !(yield* validDeclaration(content, limits.expectedEncoding))) invalid("unsupported XML declaration");
        if (retainContent) declaration = yield* source.slice(start, end + 2);
      } else {
        if (offset < end && !" \t\n\r".includes(yield* source.slice(offset, offset + 1))) invalid("invalid processing instruction");
        let body = offset;
        while (body < end && " \t\n\r".includes(yield* source.slice(body, body + 1))) {
          body++;
          pendingWork++;
          if (pendingWork >= 512) { yield 512; pendingWork -= 512; }
        }
        while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
        yield* rawContent("processing-instruction", body, end, yield* stack.peek(), target);
      }
      offset = end + 2;
    } else if ((yield* source.startsWith("<!", offset))) {
      invalid("DTD and entity declarations are forbidden");
    } else if ((yield* source.charCodeAt(offset + 1)) === 47) {
      offset += 2;
      const [name] = yield* scanName();
      yield* skipWhitespace();
      while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
      const closed = (yield* source.slice(offset++, offset)) === ">" ? (yield* stack.pop()) : undefined;
      if (closed?.name !== name) {
        if (!limits.recover) invalid("mismatched closing tag");
        limits.recover("mismatched closing tag");
      }
      if (closed) limits.events?.({ type: "close", element: closed.element, parent: (yield* stack.peek())?.element });
    } else {
      offset++;
      const repeated = previousEmpty && (yield* source.startsWith(previousEmpty.suffix, offset)) ? previousEmpty : undefined;
      const [name, prefix, localName]: [string, string, string] = repeated
        ? [repeated.name, repeated.prefix, repeated.localName]
        : (yield* scanName());
      if (repeated) offset += name.length;
      // Preserve scan/validation work while reusing the admitted spelling.
      if (repeated) pendingWork += name.length * 2;
      while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
      let attributes: Map<string, string> | undefined;
      const attrMeta: [string, string, string][] = [];
      let namespaces = (yield* stack.peek())?.namespaces ?? new Map([["xml", xmlNamespace]]);
      let ownsNamespaces = stack.length === 0;
      while (!repeated) {
        const ws = (yield* skipWhitespace());
        while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
        const ch = (yield* source.charCodeAt(offset));
        if (ch === 47 || ch === 62 || limits.recover && offset === source.length) break;
        if (ws === 0) invalid("attributes require whitespace");
        const [attribute, attrPrefix, attrLocal] = yield* scanName();
        while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
        if (attributes?.has(attribute)) invalid("duplicate attribute");
        if (++attributeCount > maxAttributes) throw new XmlLimitError("maxAttributes", "XML attribute limit exceeded");
        if ((attributes?.size ?? 0) >= maxAttributesPerElement) throw new XmlLimitError("maxAttributesPerElement", "XML attribute limit exceeded");
        yield* skipWhitespace();
        if ((yield* source.slice(offset++, offset)) !== "=") invalid("missing attribute equals");
        yield* skipWhitespace();
        const quote = (yield* source.slice(offset++, offset));
        if (quote !== '"' && quote !== "'") invalid("unquoted attribute");
        const end = (yield* source.indexOf(quote, offset));
        const scanLen = (end < 0 ? source.length : end) - offset;
        pendingWork += scanLen;
        while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
        if (end < 0) invalid("unterminated attribute");
        const raw = (yield* source.slice(offset, end));
        pendingWork += raw.length * 2;
        while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
        if (raw.indexOf("<") >= 0) invalid("less-than in attribute");
        const normalized = /[\t\n\r]/.test(raw) ? raw.replace(/[\t\n\r]/g, " ") : raw;
        const value = normalized.indexOf("&") < 0 ? (pendingWork += normalized.length, normalized) : yield* entities(normalized, limits.recover);
        while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
        admitText(value);
        (attributes ??= new Map()).set(attribute, value);
        attrMeta.push([attribute, attrPrefix, attrLocal]);
        offset = end + 1;
        if (attribute === "xmlns" || attribute.startsWith("xmlns:")) {
          const nsPrefix = attribute === "xmlns" ? "" : attribute.slice(6);
          if (nsPrefix === "xmlns" || value === xmlnsNamespace
            || (nsPrefix === "xml") !== (value === xmlNamespace)
            || (nsPrefix !== "" && value === "")) invalid("invalid namespace binding");
          if (!ownsNamespaces) {
            const copy = new Map<string, string>();
            for (const [key, uri] of namespaces) { copy.set(key, uri); pendingWork += 1; }
            namespaces = copy;
            ownsNamespaces = true;
          }
          namespaces.set(nsPrefix, value);
          if (namespaces.size > maxNamespaces) throw new XmlLimitError("maxNamespaces", "XML namespace scope limit exceeded");
        }
      }
      if (attrMeta.length > 0) {
        const expanded = attrMeta.length > 1 ? new Set<string>() : undefined;
        for (let i = 0; i < attrMeta.length; i++) {
          const [attribute, attrPrefix, attrLocal] = attrMeta[i]!;
          if (attribute === "xmlns" || attribute.startsWith("xmlns:")) continue;
          pendingWork += attribute.length;
          if (attrPrefix && !namespaces.has(attrPrefix)) invalid("unbound attribute prefix");
          if (expanded) {
            const key = `${attrPrefix ? namespaces.get(attrPrefix) : ""}\0${attrLocal}`;
            if (expanded.has(key)) invalid("duplicate expanded attribute");
            expanded.add(key);
          }
        }
      }
      pendingWork += name.length;
      while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
      if (prefix === "xmlns" || (prefix && !namespaces.has(prefix))) invalid("unbound element prefix");
      if (++nodes > maxNodes) throw new XmlLimitError("maxNodes", "XML resource limit exceeded");
      if (stack.length + 1 > maxDepth) throw new XmlLimitError("maxDepth", "XML resource limit exceeded");
      const namespace = namespaces.get(prefix) ?? "";
      limits.onElement?.({ name, namespace, localName }, (yield* stack.peek())?.element, stack.length + 1);
      admitContent();
      const retainedAttributes: XmlAttribute[] = [];
      if (retainContent && attributes) {
        for (let i = 0; i < attrMeta.length; i++) {
          const [attribute, attrPrefix, attrLocal] = attrMeta[i]!;
          const value = attributes.get(attribute)!;
          admitContent();
          retainedAttributes.push({ name: attribute, localName: attrLocal,
            namespace: attribute === "xmlns" || attrPrefix === "xmlns" ? xmlnsNamespace : attrPrefix ? namespaces.get(attrPrefix)! : "", value });
          pendingWork += attribute.length + 1;
        }
      }
      while (pendingWork >= 512) { yield 512; pendingWork -= 512; }
      const content: XmlContent[] | undefined = retain ? [] : undefined;
      const element: XmlElement = { kind: "element", name, namespace, localName, children: [], text: "", content: content ?? emptyContent, attributes: retainContent ? retainedAttributes : emptyAttributes, namespaces: retainContent ? namespaces : emptyNamespaces, ...(root === undefined && retainContent ? { prolog, epilog, ...(declaration === undefined ? {} : { declaration }) } : {}) };
      const parent = (yield* stack.peek());
      if (parent) { if (retainTree) { parent.element.children.push(element); parent.content?.push(element); } }
      else if (root) invalid("multiple root elements");
      else root = element;
      const empty = (yield* source.slice(offset, offset + 1)) === "/";
      if (empty) offset++;
      if ((yield* source.slice(offset++, offset)) !== ">") {
        if (!limits.recover) invalid("unterminated start tag");
        limits.recover("unterminated start tag");
      }
      // Only cache compact, attribute-free spellings. Namespace resolution and
      // every admission counter still run for each distinct physical element.
      if (empty && !attributes && name.length <= 512 && (yield* source.slice(offset - name.length - 3, offset)) === `<${name}/>`)
        previousEmpty = { suffix: name + "/>", name, prefix, localName };
      limits.events?.({ type: "open", element, parent: parent?.element });
      if (!empty) yield* stack.push({ element, content, name, namespaces });
      else limits.events?.({ type: "close", element, parent: parent?.element });
    }
  }
  if (pendingWork > 0) { yield pendingWork; pendingWork = 0; }
  if (!root) invalid("incomplete document");
  if (stack.length) {
    if (!limits.recover) invalid("incomplete document");
    limits.recover("incomplete document");
    while (stack.length) {
      const closed = (yield* stack.pop())!;
      limits.events?.({ type: "close", element: closed.element, parent: (yield* stack.peek())?.element });
      yield 1;
    }
  }
  return root;
}

function* normalizeXmlSteps(input: string): Generator<number, string, void> {
  const chunks: string[] = [];
  const start = input.charCodeAt(0) === 0xfeff ? 1 : 0;
  let chunkStart = start;
  let chunkLength = 0;
  let normalizedChunk = "";
  // Keep validated spans intact; only changed line endings need new strings.
  for (let index = start; index < input.length; index++) {
    const point = input.codePointAt(index)!;
    if (!validCharacter(point)) invalid("invalid character");
    if (point === 13) {
      normalizedChunk += input.slice(chunkStart, index) + "\n";
      if (input.charCodeAt(index + 1) === 10) index++;
      chunkStart = index + 1;
      chunkLength++;
    } else {
      chunkLength += point > 0xffff ? 2 : 1;
      if (point > 0xffff) index++;
    }
    if (chunkLength >= 512) {
      if (normalizedChunk) {
        chunks.push(normalizedChunk + input.slice(chunkStart, index + 1));
        normalizedChunk = "";
        chunkStart = index + 1;
      }
      chunkLength = 0;
      yield 512;
    }
  }
  if (chunkLength) yield chunkLength;
  if (chunks.length || normalizedChunk) chunks.push(normalizedChunk + input.slice(chunkStart));
  return chunks.length ? chunks.join("") : input.slice(start);
}

export function* parseXmlSteps(input: string, limits: XmlStepLimits = {}): Generator<number, XmlElement, void> {
  validateLimits(limits);
  const source = yield* normalizeXmlSteps(input);
  const parser = parseXmlSourceSteps(source.length, limits);
  let step = parser.next();
  try {
    while (!step.done) {
      if (typeof step.value === "number") yield step.value;
      else step.value.value = source.slice(step.value.offset, step.value.offset + step.value.length);
      step = parser.next();
    }
    return step.value;
  } finally { if (!step.done) parser.return(undefined as never); }
}

export function parseXml(input: string, limits: XmlLimits = {}): XmlElement {
  const parser = parseXmlSteps(input, limits);
  let result = parser.next();
  while (!result.done) result = parser.next();
  return result.value;
}

export { parseXmlStream, type XmlStreamLimits, type XmlStreamEvent } from "./stream.js";
