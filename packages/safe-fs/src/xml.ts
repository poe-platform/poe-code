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
}
export interface XmlLimits {
  readonly expectedEncoding?: "UTF-8" | "UTF-16" | "UTF-16LE" | "UTF-16BE";
  readonly retainContent?: boolean;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxAttributes?: number;
  readonly maxAttributesPerElement?: number;
  readonly maxNamespaces?: number;
  readonly maxContentNodes?: number;
  readonly onElement?: (element: XmlName, parent: XmlName | undefined, depth: number) => void;
}
export class XmlLimitError extends SyntaxError {
  constructor(readonly limit: string, message: string) { super(message); }
}

function* find(source: string, needle: string, start: number): Generator<number, number, void> {
  let work = 0;
  for (let offset = start; offset < source.length; offset++) {
    if (source.startsWith(needle, offset)) { if (work) yield work; return offset; }
    if (++work === 512) { yield work; work = 0; }
  }
  if (work) yield work;
  return -1;
}

const xmlNamespace = "http://www.w3.org/XML/1998/namespace";
const xmlnsNamespace = "http://www.w3.org/2000/xmlns/";

function invalid(message: string): never {
  throw new SyntaxError(`Invalid XML: ${message}`);
}

function validCharacter(point: number): boolean {
  return point === 9 || point === 10 || point === 13
    || (point >= 0x20 && point <= 0xd7ff)
    || (point >= 0xe000 && point <= 0xfffd)
    || (point >= 0x10000 && point <= 0x10ffff);
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

function* qualifiedName(name: string): Generator<number, [string, string], void> {
  let prefix = "";
  let start = 0;
  let first = true;
  let work = 0;
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
    const width = point > 0xffff ? 2 : 1;
    offset += width;
    work += width;
    if (work >= 512) { yield work; work = 0; }
  }
  if (first) invalid("invalid qualified name");
  if (work) yield work;
  return [prefix, name.slice(start)];
}

function* entities(text: string): Generator<number, string, void> {
  let result = "";
  let offset = 0;
  while (offset < text.length) {
    const start = yield* find(text, "&", offset);
    if (start < 0) return result + text.slice(offset);
    result += text.slice(offset, start);
    const end = yield* find(text, ";", start + 1);
    if (end < 0) invalid("unterminated entity");
    const entity = text.slice(start + 1, end);
    const predefined: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (Object.hasOwn(predefined, entity)) result += predefined[entity];
    else {
      const hexadecimal = entity.startsWith("#x");
      const digits = entity.slice(hexadecimal ? 2 : 1);
      if (!entity.startsWith("#") || !digits.length) invalid("undeclared entity");
      let point = 0;
      for (let index = 0; index < digits.length; index++) {
        const code = digits.charCodeAt(index);
        const digit = code >= 48 && code <= 57 ? code - 48 : hexadecimal && code >= 65 && code <= 70 ? code - 55
          : hexadecimal && code >= 97 && code <= 102 ? code - 87 : -1;
        if (digit < 0) invalid("undeclared entity");
        point = point * (hexadecimal ? 16 : 10) + digit;
        if (point > 0x10ffff) invalid("invalid character reference");
        if ((index + 1) % 512 === 0) yield 512;
      }
      if (digits.length % 512) yield digits.length % 512;
      if (!validCharacter(point)) invalid("invalid character reference");
      result += String.fromCodePoint(point);
    }
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
    if (content.slice(offset, offset + name.length).toLowerCase() !== name) return undefined;
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
  if (content.slice(offset, offset + 8).toLowerCase() === "encoding") {
    if (!spacing) return false;
    const encoding = yield* field("encoding");
    if (encoding === undefined || encoding.length > 8 || !["utf-8", "utf-16", "utf-16le", "utf-16be"].includes(encoding.toLowerCase())) return false;
    if (expectedEncoding !== undefined && encoding.toLowerCase() !== expectedEncoding.toLowerCase()) return false;
    spacing = yield* whitespace();
  }
  if (content.slice(offset, offset + 10).toLowerCase() === "standalone") {
    if (!spacing) return false;
    const standalone = yield* field("standalone");
    if (standalone === undefined || standalone.length > 3 || !["yes", "no"].includes(standalone.toLowerCase())) return false;
    yield* whitespace();
  }
  return offset === content.length;
}

export function* parseXmlSteps(input: string, limits: XmlLimits = {}): Generator<number, XmlElement, void> {
  const maxDepth = limits.maxDepth ?? 64;
  const maxNodes = limits.maxNodes ?? 100_000;
  const maxAttributes = limits.maxAttributes ?? 10_000;
  const retainContent = limits.retainContent !== false;
  const maxContentNodes = limits.maxContentNodes ?? (retainContent ? 100_000 : maxNodes);
  const emptyContent: readonly XmlContent[] = Object.freeze([]);
  const emptyAttributes: readonly XmlAttribute[] = Object.freeze([]);
  const emptyNamespaces: ReadonlyMap<string, string> = new Map();
  const maxAttributesPerElement = limits.maxAttributesPerElement ?? 128;
  const maxNamespaces = limits.maxNamespaces ?? 256;
  for (const limit of [maxDepth, maxNodes, maxAttributes, maxContentNodes, maxAttributesPerElement, maxNamespaces]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("XML limits must be positive integers");
  }
  const chunks: string[] = [];
  let chunk = "";
  for (let index = input.charCodeAt(0) === 0xfeff ? 1 : 0; index < input.length; index++) {
    const point = input.codePointAt(index)!;
    if (!validCharacter(point)) invalid("invalid character");
    if (point === 13) {
      chunk += "\n";
      if (input.charCodeAt(index + 1) === 10) index++;
    } else {
      chunk += String.fromCodePoint(point);
      if (point > 0xffff) index++;
    }
    if (chunk.length >= 512) { chunks.push(chunk); chunk = ""; yield 512; }
  }
  chunks.push(chunk);
  if (chunk.length) yield chunk.length;
  const source = chunks.join("");
  const stack: { element: XmlElement; content: XmlContent[] | undefined; name: string; namespaces: Map<string, string> }[] = [];
  let root: XmlElement | undefined;
  let declaration: string | undefined;
  let offset = 0;
  let nodes = 0;
  let attributeCount = 0;
  let contentNodes = 0;
  const admitContent = (): void => {
    if (++contentNodes > maxContentNodes) throw new XmlLimitError("maxContentNodes", "XML content node limit exceeded");
  };
  const whitespace = function* (): Generator<number, void, void> {
    let work = 0;
    while (offset < source.length && " \t\n\r".includes(source[offset]!)) {
      offset++;
      if (++work === 512) { yield work; work = 0; }
    }
    if (work) yield work;
  };
  const readName = function* (): Generator<number, string, void> {
    const start = offset;
    while (offset < source.length && !" \t\r\n/=>?".includes(source[offset]!)) {
      offset++;
      if ((offset - start) % 512 === 0) yield 512;
    }
    if ((offset - start) % 512) yield (offset - start) % 512;
    const name = source.slice(start, offset);
    yield* qualifiedName(name);
    return name;
  };
  const appendText = function* (text: string, kind: "text" | "cdata" = "text"): Generator<number, void, void> {
    const parent = stack.at(-1);
    if (parent) {
      parent.element.text += text;
      if (retainContent && (text.length || kind === "cdata")) {
        admitContent();
        parent.content!.push({ kind, text });
      }
    }
    else {
      for (let index = 0; index < text.length; index++) {
        if (!" \t\r\n".includes(text[index]!)) invalid("text outside the root");
        if ((index + 1) % 512 === 0) yield 512;
      }
      if (text.length % 512) yield text.length % 512;
    }
  };
  while (offset < source.length) {
    yield 1;
    if (source[offset] !== "<") {
      const next = yield* find(source, "<", offset);
      const text = source.slice(offset, next < 0 ? source.length : next);
      if ((yield* find(text, "]]>", 0)) >= 0) invalid("CDATA terminator in text");
      yield* appendText(yield* entities(text));
      offset += text.length;
    } else if (source.startsWith("<!--", offset)) {
      const end = yield* find(source, "-->", offset + 4);
      if (end < 0 || (yield* find(source.slice(offset + 4, end), "--", 0)) >= 0 || source.slice(offset + 4, end).endsWith("-")) {
        invalid("malformed comment");
      }
      const parent = stack.at(-1);
      if (retainContent && parent) { admitContent(); parent.content!.push({ kind: "comment", text: source.slice(offset + 4, end) }); }
      offset = end + 3;
    } else if (source.startsWith("<![CDATA[", offset)) {
      if (!stack.length) invalid("CDATA outside root");
      const end = yield* find(source, "]]>", offset + 9);
      if (end < 0) invalid("unterminated CDATA");
      yield* appendText(source.slice(offset + 9, end), "cdata");
      offset = end + 3;
    } else if (source.startsWith("<?", offset)) {
      const start = offset;
      offset += 2;
      const target = yield* readName();
      const end = yield* find(source, "?>", offset);
      if (end < 0) invalid("unterminated processing instruction");
      const content = source.slice(offset, end);
      if (target.length === 3 && target.toLowerCase() === "xml") {
        if (start !== 0 || target !== "xml"
          || !(yield* validDeclaration(content, limits.expectedEncoding))) {
          invalid("unsupported XML declaration");
        }
        if (retainContent) declaration = source.slice(start, end + 2);
      } else if (content && !" \t\n\r".includes(content[0]!)) invalid("invalid processing instruction");
      if (!(target.length === 3 && target.toLowerCase() === "xml")) {
        const parent = stack.at(-1);
        if (retainContent && parent) {
          let start = 0;
          while (start < content.length && " \t\n\r".includes(content[start]!)) {
            start++;
            if (start % 512 === 0) yield 512;
          }
          if (start % 512) yield start % 512;
          admitContent();
          parent.content!.push({ kind: "processing-instruction", target, text: content.slice(start) });
        }
      }
      offset = end + 2;
    } else if (source.startsWith("<!", offset)) {
      invalid("DTD and entity declarations are forbidden");
    } else if (source.startsWith("</", offset)) {
      offset += 2;
      const name = yield* readName();
      yield* whitespace();
      if (source[offset++] !== ">" || stack.pop()?.name !== name) invalid("mismatched closing tag");
    } else {
      offset++;
      const name = yield* readName();
      const attributes = new Map<string, string>();
      let namespaces = stack.at(-1)?.namespaces ?? new Map([["xml", xmlNamespace]]);
      let ownsNamespaces = stack.length === 0;
      while (true) {
        const beforeSpace = offset;
        yield* whitespace();
        if (source[offset] === "/" || source[offset] === ">") break;
        if (offset === beforeSpace) invalid("attributes require whitespace");
        const attribute = yield* readName();
        if (attributes.has(attribute)) invalid("duplicate attribute");
        if (++attributeCount > maxAttributes) throw new XmlLimitError("maxAttributes", "XML attribute limit exceeded");
        if (attributes.size >= maxAttributesPerElement) throw new XmlLimitError("maxAttributesPerElement", "XML attribute limit exceeded");
        yield* whitespace();
        if (source[offset++] !== "=") invalid("missing attribute equals");
        yield* whitespace();
        const quote = source[offset++];
        if (quote !== '"' && quote !== "'") invalid("unquoted attribute");
        const end = yield* find(source, quote, offset);
        if (end < 0) invalid("unterminated attribute");
        const raw = source.slice(offset, end);
        if ((yield* find(raw, "<", 0)) >= 0) invalid("less-than in attribute");
        let normalized = "";
        for (let index = 0; index < raw.length; index++) {
          const character = raw[index]!;
          normalized += character === "\t" || character === "\n" || character === "\r" ? " " : character;
          if ((index + 1) % 512 === 0) yield 512;
        }
        if (raw.length % 512) yield raw.length % 512;
        const value = yield* entities(normalized);
        attributes.set(attribute, value);
        offset = end + 1;
        if (attribute === "xmlns" || attribute.startsWith("xmlns:")) {
          const prefix = attribute === "xmlns" ? "" : attribute.slice(6);
          if (prefix === "xmlns" || value === xmlnsNamespace
            || (prefix === "xml") !== (value === xmlNamespace)
            || (prefix !== "" && value === "")) invalid("invalid namespace binding");
          if (!ownsNamespaces) {
            const copy = new Map<string, string>();
            for (const [key, uri] of namespaces) { copy.set(key, uri); yield 1; }
            namespaces = copy;
            ownsNamespaces = true;
          }
          namespaces.set(prefix, value);
          if (namespaces.size > maxNamespaces) throw new XmlLimitError("maxNamespaces", "XML namespace scope limit exceeded");
        }
      }
      const expanded = new Set<string>();
      for (const attribute of attributes.keys()) {
        if (attribute === "xmlns" || attribute.startsWith("xmlns:")) continue;
        const [prefix, localName] = yield* qualifiedName(attribute);
        if (prefix && !namespaces.has(prefix)) invalid("unbound attribute prefix");
        const key = JSON.stringify([prefix ? namespaces.get(prefix) : "", localName]);
        if (expanded.has(key)) invalid("duplicate expanded attribute");
        expanded.add(key);
      }
      const [prefix, localName] = yield* qualifiedName(name);
      if (prefix === "xmlns" || (prefix && !namespaces.has(prefix))) invalid("unbound element prefix");
      if (++nodes > maxNodes) throw new XmlLimitError("maxNodes", "XML resource limit exceeded");
      if (stack.length + 1 > maxDepth) throw new XmlLimitError("maxDepth", "XML resource limit exceeded");
      const namespace = namespaces.get(prefix) ?? "";
      limits.onElement?.({ name, namespace, localName }, stack.at(-1)?.element, stack.length + 1);
      admitContent();
      const retainedAttributes: XmlAttribute[] = [];
      for (const [attribute, value] of retainContent ? attributes : []) {
        const [prefix, localName] = yield* qualifiedName(attribute);
        admitContent();
        retainedAttributes.push({ name: attribute, localName,
          namespace: attribute === "xmlns" || prefix === "xmlns" ? xmlnsNamespace : prefix ? namespaces.get(prefix)! : "", value });
        yield 1;
      }
      const content: XmlContent[] | undefined = retainContent ? [] : undefined;
      const element: XmlElement = { kind: "element", name, namespace, localName, children: [], text: "", content: content ?? emptyContent, attributes: retainContent ? retainedAttributes : emptyAttributes, namespaces: retainContent ? namespaces : emptyNamespaces, ...(root === undefined && declaration !== undefined ? { declaration } : {}) };
      const parent = stack.at(-1);
      if (parent) { parent.element.children.push(element); parent.content?.push(element); }
      else if (root) invalid("multiple root elements");
      else root = element;
      const empty = source[offset] === "/";
      if (empty) offset++;
      if (source[offset++] !== ">") invalid("unterminated start tag");
      if (!empty) stack.push({ element, content, name, namespaces });
    }
  }
  if (stack.length || !root) invalid("incomplete document");
  return root;
}

export function parseXml(input: string, limits: XmlLimits = {}): XmlElement {
  const parser = parseXmlSteps(input, limits);
  let result = parser.next();
  while (!result.done) result = parser.next();
  return result.value;
}
