export interface XmlElement {
  readonly namespace: string;
  readonly localName: string;
  readonly children: XmlElement[];
  text: string;
}

export interface XmlLimits {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxAttributes?: number;
  readonly maxResponses?: number;
}

export class XmlResponseLimitError extends SyntaxError {}

const xmlNamespace = "http://www.w3.org/XML/1998/namespace";
const xmlnsNamespace = "http://www.w3.org/2000/xmlns/";

function invalid(message: string): never {
  throw new SyntaxError(`Invalid WebDAV XML: ${message}`);
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

function qualifiedName(name: string): [string, string] {
  const parts = name.split(":");
  if (parts.length > 2 || parts.some((part) => {
    const points = [...part].map((character) => character.codePointAt(0)!);
    return points.length === 0 || !nameStart(points[0]!) || points.slice(1).some((point) => !namePart(point));
  })) invalid("invalid qualified name");
  return parts.length === 1 ? ["", parts[0]!] : [parts[0]!, parts[1]!];
}

function entities(text: string): string {
  let result = "";
  let offset = 0;
  while (offset < text.length) {
    const start = text.indexOf("&", offset);
    if (start < 0) return result + text.slice(offset);
    result += text.slice(offset, start);
    const end = text.indexOf(";", start + 1);
    if (end < 0) invalid("unterminated entity");
    const entity = text.slice(start + 1, end);
    const predefined: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (Object.hasOwn(predefined, entity)) result += predefined[entity];
    else {
      const hexadecimal = entity.startsWith("#x");
      const digits = entity.slice(hexadecimal ? 2 : 1);
      if (!entity.startsWith("#") || !(hexadecimal ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits)) {
        invalid("undeclared entity");
      }
      const point = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (!validCharacter(point)) invalid("invalid character reference");
      result += String.fromCodePoint(point);
    }
    offset = end + 1;
  }
  return result;
}

export function parseXml(input: string, limits: XmlLimits = {}): XmlElement {
  const maxDepth = limits.maxDepth ?? 64;
  const maxNodes = limits.maxNodes ?? 100_000;
  const maxAttributes = limits.maxAttributes ?? 10_000;
  for (const limit of [maxDepth, maxNodes, maxAttributes, ...(limits.maxResponses === undefined ? [] : [limits.maxResponses])]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("XML limits must be positive integers");
  }
  for (const character of input) {
    if (!validCharacter(character.codePointAt(0)!)) invalid("invalid character");
  }
  const source = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const stack: { element: XmlElement; name: string; namespaces: Map<string, string> }[] = [];
  let root: XmlElement | undefined;
  let offset = 0;
  let nodes = 0;
  let attributeCount = 0;
  let responses = 0;
  const whitespace = (): void => {
    while (offset < source.length && " \t\n\r".includes(source[offset]!)) offset++;
  };
  const readName = (): string => {
    const start = offset;
    while (offset < source.length && !" \t\r\n/=>?".includes(source[offset]!)) offset++;
    const name = source.slice(start, offset);
    qualifiedName(name);
    return name;
  };
  const appendText = (text: string): void => {
    const parent = stack.at(-1);
    if (parent) parent.element.text += text;
    else if (!/^[ \t\r\n]*$/.test(text)) invalid("text outside the root");
  };
  while (offset < source.length) {
    if (source[offset] !== "<") {
      const next = source.indexOf("<", offset);
      const text = source.slice(offset, next < 0 ? source.length : next);
      if (text.includes("]]>")) invalid("CDATA terminator in text");
      appendText(entities(text));
      offset += text.length;
    } else if (source.startsWith("<!--", offset)) {
      const end = source.indexOf("-->", offset + 4);
      if (end < 0 || source.slice(offset + 4, end).includes("--") || source.slice(offset + 4, end).endsWith("-")) {
        invalid("malformed comment");
      }
      offset = end + 3;
    } else if (source.startsWith("<![CDATA[", offset)) {
      if (!stack.length) invalid("CDATA outside root");
      const end = source.indexOf("]]>", offset + 9);
      if (end < 0) invalid("unterminated CDATA");
      appendText(source.slice(offset + 9, end));
      offset = end + 3;
    } else if (source.startsWith("<?", offset)) {
      const start = offset;
      offset += 2;
      const target = readName();
      const end = source.indexOf("?>", offset);
      if (end < 0) invalid("unterminated processing instruction");
      const content = source.slice(offset, end);
      if (target.toLowerCase() === "xml") {
        if (start !== 0 || target !== "xml"
          || !/^\s+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])(?:UTF-8|UTF-16|UTF-16LE|UTF-16BE)\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*$/i.test(content)) {
          invalid("unsupported XML declaration");
        }
      } else if (content && !" \t\n\r".includes(content[0]!)) invalid("invalid processing instruction");
      offset = end + 2;
    } else if (source.startsWith("<!", offset)) {
      invalid("DTD and entity declarations are forbidden");
    } else if (source.startsWith("</", offset)) {
      offset += 2;
      const name = readName();
      whitespace();
      if (source[offset++] !== ">" || stack.pop()?.name !== name) invalid("mismatched closing tag");
    } else {
      offset++;
      const name = readName();
      const attributes = new Map<string, string>();
      const namespaces = new Map(stack.at(-1)?.namespaces ?? [["xml", xmlNamespace]]);
      while (true) {
        const beforeSpace = offset;
        whitespace();
        if (source[offset] === "/" || source[offset] === ">") break;
        if (offset === beforeSpace) invalid("attributes require whitespace");
        const attribute = readName();
        if (attributes.has(attribute)) invalid("duplicate attribute");
        if (++attributeCount > maxAttributes || attributes.size >= 128) invalid("XML attribute limit exceeded");
        whitespace();
        if (source[offset++] !== "=") invalid("missing attribute equals");
        whitespace();
        const quote = source[offset++];
        if (quote !== '"' && quote !== "'") invalid("unquoted attribute");
        const end = source.indexOf(quote, offset);
        if (end < 0) invalid("unterminated attribute");
        const raw = source.slice(offset, end);
        if (raw.includes("<")) invalid("less-than in attribute");
        const value = entities(raw.replace(/[\t\n\r]/g, " "));
        attributes.set(attribute, value);
        offset = end + 1;
        if (attribute === "xmlns" || attribute.startsWith("xmlns:")) {
          const prefix = attribute === "xmlns" ? "" : attribute.slice(6);
          if (prefix === "xmlns" || value === xmlnsNamespace
            || (prefix === "xml") !== (value === xmlNamespace)
            || (prefix !== "" && value === "")) invalid("invalid namespace binding");
          namespaces.set(prefix, value);
          if (namespaces.size > 256) invalid("XML namespace scope limit exceeded");
        }
      }
      const expanded = new Set<string>();
      for (const attribute of attributes.keys()) {
        if (attribute === "xmlns" || attribute.startsWith("xmlns:")) continue;
        const [prefix, localName] = qualifiedName(attribute);
        if (prefix && !namespaces.has(prefix)) invalid("unbound attribute prefix");
        const key = JSON.stringify([prefix ? namespaces.get(prefix) : "", localName]);
        if (expanded.has(key)) invalid("duplicate expanded attribute");
        expanded.add(key);
      }
      const [prefix, localName] = qualifiedName(name);
      if (prefix === "xmlns" || (prefix && !namespaces.has(prefix))) invalid("unbound element prefix");
      if (++nodes > maxNodes || stack.length + 1 > maxDepth) invalid("XML resource limit exceeded");
      const namespace = namespaces.get(prefix) ?? "";
      if (limits.maxResponses !== undefined && stack.length === 1
        && root?.namespace === "DAV:" && root.localName === "multistatus"
        && namespace === "DAV:" && localName === "response"
        && ++responses > limits.maxResponses) {
        throw new XmlResponseLimitError("WebDAV XML response limit exceeded");
      }
      const element: XmlElement = { namespace, localName, children: [], text: "" };
      const parent = stack.at(-1);
      if (parent) parent.element.children.push(element);
      else if (root) invalid("multiple root elements");
      else root = element;
      const empty = source[offset] === "/";
      if (empty) offset++;
      if (source[offset++] !== ">") invalid("unterminated start tag");
      if (!empty) stack.push({ element, name, namespaces });
    }
  }
  if (stack.length || !root) invalid("incomplete document");
  return root;
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
