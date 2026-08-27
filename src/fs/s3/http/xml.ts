import { S3ServiceError } from "../transport.js";

export interface XmlNode {
  readonly name: string;
  readonly children: XmlNode[];
  text: string;
}

export function malformed(message = "invalid S3 XML response"): never {
  throw new S3ServiceError("InvalidResponse", 502, message);
}

function validCharacter(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xd7ff)
    || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}

function decodeEntities(text: string): string {
  let result = "";
  let position = 0;
  while (position < text.length) {
    const start = text.indexOf("&", position);
    if (start < 0) return result + text.slice(position);
    result += text.slice(position, start);
    const end = text.indexOf(";", start + 1);
    if (end < 0 || end - start > 12) malformed("invalid XML entity");
    const entity = text.slice(start + 1, end);
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (Object.hasOwn(named, entity)) result += named[entity];
    else {
      const hexadecimal = entity.startsWith("#x");
      const digits = entity.slice(hexadecimal ? 2 : 1);
      if (!entity.startsWith("#") || !(hexadecimal ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits)) malformed("unknown XML entity");
      const code = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (!validCharacter(code)) malformed("invalid XML code point");
      result += String.fromCodePoint(code);
    }
    position = end + 1;
  }
  return result;
}

export function parseXml(bytes: Uint8Array): XmlNode {
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return malformed("XML is not UTF-8"); }
  for (const character of xml) if (!validCharacter(character.codePointAt(0)!)) malformed("invalid XML character");
  xml = xml.replace(/\r\n?/g, "\n");
  let position = 0;
  let nodes = 0;
  let root: XmlNode | undefined;
  const stack: XmlNode[] = [];
  const whitespace = (): void => { while (position < xml.length && /[ \t\r\n]/.test(xml[position]!)) position++; };
  const name = (): string => {
    const start = position;
    if (!/[A-Za-z_]/.test(xml[position] ?? "")) malformed("invalid XML name");
    while (position < xml.length && /[A-Za-z0-9_.:-]/.test(xml[position]!)) position++;
    const result = xml.slice(start, position);
    if (result.length > 256) malformed("XML name too long");
    return result;
  };
  while (position < xml.length) {
    if (xml[position] !== "<") {
      const end = xml.indexOf("<", position);
      const text = xml.slice(position, end < 0 ? xml.length : end);
      if (text.includes("]]>")) malformed();
      const current = stack.at(-1);
      if (current) current.text += decodeEntities(text);
      else if (text.trim()) malformed("text outside XML root");
      position = end < 0 ? xml.length : end;
      continue;
    }
    if (xml.startsWith("<?xml ", position) && !root && position === 0) {
      const end = xml.indexOf("?>", position);
      if (end < 0 || end > 256) malformed();
      const declaration = xml.slice(position, end);
      if (!/^<\?xml\s+version\s*=\s*(?:"1\.0"|'1\.0')(?:\s+encoding\s*=\s*(?:"[Uu][Tt][Ff]-8"|'[Uu][Tt][Ff]-8'))?(?:\s+standalone\s*=\s*(?:"(?:yes|no)"|'(?:yes|no)'))?\s*$/.test(declaration)) malformed("unsupported XML declaration");
      position = end + 2;
      continue;
    }
    if (xml.startsWith("<!--", position)) {
      const end = xml.indexOf("-->", position + 4);
      const comment = xml.slice(position + 4, end);
      if (end < 0 || comment.includes("--") || comment.endsWith("-")) malformed();
      position = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", position)) {
      const end = xml.indexOf("]]>", position + 9);
      const current = stack.at(-1);
      if (end < 0 || !current) malformed();
      current.text += xml.slice(position + 9, end);
      position = end + 3;
      continue;
    }
    position++;
    const closing = xml[position] === "/";
    if (closing) position++;
    const tag = name();
    if (closing) {
      whitespace();
      if (xml[position++] !== ">" || stack.pop()?.name !== tag) malformed("mismatched XML close tag");
      continue;
    }
    const attributes = new Set<string>();
    while (true) {
      const previous = position;
      whitespace();
      if (xml[position] === ">" || xml[position] === "/") break;
      if (previous === position || attributes.size >= 32) malformed("invalid XML attributes");
      const attribute = name();
      if (attributes.has(attribute)) malformed("duplicate XML attribute");
      attributes.add(attribute);
      whitespace();
      if (xml[position++] !== "=") malformed();
      whitespace();
      const quote = xml[position++];
      if (quote !== '"' && quote !== "'") malformed();
      const end = xml.indexOf(quote, position);
      if (end < 0 || xml.slice(position, end).includes("<")) malformed();
      decodeEntities(xml.slice(position, end));
      position = end + 1;
    }
    const selfClosing = xml[position] === "/";
    if (selfClosing) position++;
    if (xml[position++] !== ">") malformed();
    if (++nodes > 32_768 || stack.length >= 32) malformed("XML structure limit exceeded");
    const node: XmlNode = { name: tag, text: "", children: [] };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else if (root) malformed("multiple XML roots");
    else root = node;
    if (!selfClosing) stack.push(node);
  }
  if (!root || stack.length) malformed("incomplete XML");
  return root;
}

export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter(child => child.name === name);
}

export function text(node: XmlNode, name: string, required = false): string | undefined {
  const matches = children(node, name);
  if (matches.length > 1 || (required && matches.length !== 1)) malformed(`invalid ${name} count`);
  const child = matches[0];
  if (child?.children.length) malformed(`invalid ${name} value`);
  return child?.text;
}

export function integer(value: string): number {
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value))) malformed("invalid integer");
  return Number(value);
}

export function timestamp(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) malformed("invalid timestamp");
  return date;
}
