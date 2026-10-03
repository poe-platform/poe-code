import type { Parser, SyntaxNode } from '@lezer/common';
import { parser as javascript } from '@lezer/javascript';
import { parser as json } from '@lezer/json';
import { parser as yaml } from '@lezer/yaml';
import { parser as html } from '@lezer/html';
import { parser as css } from '@lezer/css';

export type Language = 'typescript' | 'tsx' | 'javascript' | 'jsx' | 'json' | 'yaml' | 'html' | 'css';
export interface Position { line: number; column: number }
export interface CodeNode {
  kind: string;
  /** Half-open UTF-8 byte offsets. */
  range: [number, number];
  /** Zero-based line and UTF-8 byte column. */
  start: Position;
  end: Position;
  text: string;
  children: CodeNode[];
  parent?: CodeNode;
  previousSibling?: CodeNode;
  nextSibling?: CodeNode;
  trivia: boolean;
  language: Language;
}
export interface CodeTree {
  source: string;
  language: Language;
  root: CodeNode;
  errors: CodeNode[];
  walk(): IterableIterator<CodeNode>;
}
const parsers: Record<Language, Parser> = {
  typescript: javascript.configure({ dialect: 'ts' }),
  tsx: javascript.configure({ dialect: 'ts jsx' }),
  javascript, jsx: javascript.configure({ dialect: 'jsx' }), json, yaml, html, css
};
const extensions: Record<string, Language> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', typescript: 'typescript',
  tsx: 'tsx', jsx: 'jsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript', javascript: 'javascript',
  json: 'json', yaml: 'yaml', yml: 'yaml', html: 'html', css: 'css'
};
export function languageFor(filenameOrLanguage: string): Language {
  const suffix = filenameOrLanguage.toLowerCase().split('.').at(-1)!;
  const language = extensions[suffix];
  if (!language) throw new Error(`Unsupported language: ${filenameOrLanguage}`);
  return language;
}
export function* walk(node: CodeNode): IterableIterator<CodeNode> {
  const stack = [node];
  while (stack.length) {
    const current = stack.pop()!;
    yield current;
    for (let i = current.children.length - 1; i >= 0; i--) stack.push(current.children[i]!);
  }
}

/** Parse without I/O. Recovery nodes are retained and listed in errors. */
export function parseCode(source: string, filenameOrLanguage = 'typescript'): CodeTree {
  const language = languageFor(filenameOrLanguage);
  const bytes: number[] = [];
  const positions: Position[] = [];
  let offset = 0, byte = 0, line = 0, column = 0;
  for (const char of source) {
    const codePoint = char.codePointAt(0)!;
    const width = codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
    for (let j = 0; j < char.length; j++) {
      bytes[offset + j] = byte;
      positions[offset + j] = { line, column };
    }
    offset += char.length;
    byte += width;
    if (char === '\n' || (char === '\r' && source[offset] !== '\n')) { line++; column = 0; }
    else column += width;
  }
  bytes[offset] = byte;
  positions[offset] = { line, column };
  const errors: CodeNode[] = [];
  function node(kind: string, from: number, to: number, trivia = false): CodeNode {
    return { kind, range: [bytes[from]!, bytes[to]!], start: positions[from]!, end: positions[to]!,
      text: source.slice(from, to), children: [], trivia, language };
  }
  function convert(raw: SyntaxNode): CodeNode {
    const result = node(raw.type.isError ? 'ERROR' : raw.name, raw.from, raw.to,
      raw.name.includes('Comment'));
    if (raw.type.isError) errors.push(result);
    let end = raw.from;
    for (let child = raw.firstChild; child; child = child.nextSibling) {
      if (child.from > end) result.children.push(node('Trivia', end, child.from, true));
      result.children.push(convert(child));
      end = child.to;
    }
    if (result.children.length && end < raw.to) result.children.push(node('Trivia', end, raw.to, true));
    result.children.forEach((child, i) => {
      child.parent = result;
      if (i > 0) child.previousSibling = result.children[i - 1]!;
      if (i + 1 < result.children.length) child.nextSibling = result.children[i + 1]!;
    });
    return result;
  }
  const root = convert(parsers[language].parse(source).topNode);
  return { source, language, root, errors, walk: () => walk(root) };
}
