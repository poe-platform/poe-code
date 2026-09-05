import type { Document, Node, Pair, YAMLMap, YAMLSeq } from "yaml";
import { MikeError, type NativeWork } from "./native-work.js";

export type YamlModule = typeof import("yaml");
export interface NativeDocument {
  doc: Document<Node>;
  filename: string;
  fileIndex: number;
  documentIndex: number;
  format: "yaml" | "json";
}
export interface Candidate {
  node: Node;
  document: NativeDocument;
  isDocumentRoot?: true;
  parent?: YAMLMap | YAMLSeq;
  slot?: number;
}

export async function loadYaml(): Promise<YamlModule> {
  try { return await import("yaml"); }
  catch { throw new MikeError("the optional yaml@2.9.0 peer is required for this yq profile"); }
}

export function scalar(yaml: YamlModule, work: NativeWork, value: unknown): Node {
  work.node();
  if (typeof value === "string" && Buffer.byteLength(value) > work.limits.maxScalarBytes) throw new MikeError("yq limit exceeded: maxScalarBytes");
  return new yaml.Scalar(value);
}

export function root(document: NativeDocument): Candidate { return { node: document.doc.contents!, document, isDocumentRoot: true }; }

export function nodeTag(node: Node, yaml: YamlModule): string {
  if (node.tag) return node.tag.replace("tag:yaml.org,2002:", "!!");
  if (yaml.isMap(node)) return "!!map";
  if (yaml.isSeq(node)) return "!!seq";
  if (yaml.isAlias(node)) return "";
  const value = node.value;
  if (value === null || value === undefined) return "!!null";
  if (typeof value === "boolean") return "!!bool";
  if (typeof value === "bigint" || typeof value === "number" && Number.isInteger(value)) return "!!int";
  if (typeof value === "number") return "!!float";
  return "!!str";
}

export function truth(node: Node, yaml: YamlModule): boolean {
  return !yaml.isScalar(node) || node.value !== null && node.value !== undefined && node.value !== false;
}

export function dereference(candidate: Candidate, yaml: YamlModule, work: NativeWork): Candidate {
  let node = candidate.node;
  const seen = new Set<Node>();
  while (yaml.isAlias(node)) {
    work.alias();
    if (seen.has(node)) throw new MikeError("cyclic YAML alias");
    seen.add(node);
    const resolved = node.resolve(candidate.document.doc);
    if (!resolved) throw new MikeError(`unknown anchor '${node.source}' referenced`);
    node = resolved;
  }
  return node === candidate.node ? candidate : { node, document: candidate.document };
}

export async function inspectNode(node: Node, yaml: YamlModule, work: NativeWork, allocate = false): Promise<void> {
  const pending: { node: Node; depth: number }[] = [{ node, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const current = pending.pop()!;
    work.depth(current.depth);
    if (++count > work.limits.maxParserNodes) throw new MikeError("yq limit exceeded: maxParserNodes");
    await work.tick();
    if (allocate) work.node();
    if (yaml.isScalar(current.node)) {
      if (typeof current.node.value === "string" && Buffer.byteLength(current.node.value) > work.limits.maxScalarBytes) throw new MikeError("yq limit exceeded: maxScalarBytes");
    } else if (yaml.isMap(current.node)) {
      for (const pair of current.node.items) {
        if (yaml.isNode(pair.key)) pending.push({ node: pair.key, depth: current.depth + 1 });
        if (yaml.isNode(pair.value)) pending.push({ node: pair.value, depth: current.depth + 1 });
      }
    } else if (yaml.isSeq(current.node)) {
      for (const child of current.node.items) if (yaml.isNode(child)) pending.push({ node: child, depth: current.depth + 1 });
    }
  }
}

export async function cloneNode(node: Node, yaml: YamlModule, work: NativeWork): Promise<Node> {
  await inspectNode(node, yaml, work, true);
  work.assertOpen();
  const cloned = node.clone() as Node;
  const pending = [{ original: node, cloned }];
  while (pending.length) {
    const current = pending.pop()!;
    await work.tick();
    if (work.implicitTags.has(current.original)) work.implicitTags.add(current.cloned);
    if (yaml.isMap(current.original) && yaml.isMap(current.cloned)) for (let index = 0; index < current.original.items.length; index++) {
      const original = current.original.items[index]!;
      const copy = current.cloned.items[index]!;
      if (yaml.isNode(original.key) && yaml.isNode(copy.key)) pending.push({ original: original.key, cloned: copy.key });
      if (yaml.isNode(original.value) && yaml.isNode(copy.value)) pending.push({ original: original.value, cloned: copy.value });
    }
    else if (yaml.isSeq(current.original) && yaml.isSeq(current.cloned)) for (let index = 0; index < current.original.items.length; index++) {
      const original = current.original.items[index];
      const copy = current.cloned.items[index];
      if (yaml.isNode(original) && yaml.isNode(copy)) pending.push({ original, cloned: copy });
    }
  }
  return cloned;
}

export async function replace(candidate: Candidate, incoming: Node, yaml: YamlModule, work: NativeWork, clobber = false): Promise<void> {
  const node = await cloneNode(incoming, yaml, work);
  const previous = candidate.node;
  if (previous.comment !== undefined) node.comment = previous.comment;
  if (previous.commentBefore !== undefined) node.commentBefore = previous.commentBefore;
  if (previous.spaceBefore !== undefined) node.spaceBefore = previous.spaceBefore;
  if ("anchor" in previous && "anchor" in node) node.anchor = previous.anchor;
  if (!clobber && previous.tag && (!previous.tag.startsWith("tag:yaml.org,2002:") || nodeTag(node, yaml) === nodeTag(previous, yaml))) {
    node.tag = previous.tag;
    if (work.implicitTags.has(previous)) work.implicitTags.add(node);
  }
  if (yaml.isScalar(node) && yaml.isScalar(previous) && previous.type !== undefined) node.type = previous.type;
  if (candidate.parent) {
    if (yaml.isMap(candidate.parent)) (candidate.parent.items[candidate.slot!] as Pair).value = node;
    else candidate.parent.items[candidate.slot!] = node;
  } else if (candidate.isDocumentRoot) candidate.document.doc.contents = node;
  candidate.node = node;
}

async function admitCst(token: unknown, work: NativeWork): Promise<void> {
  const pending: { value: unknown; depth: number }[] = [{ value: token, depth: 0 }];
  let nodes = 0;
  let composed = 0;
  let bytes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (!value || typeof value !== "object") continue;
    await work.tick();
    if (Array.isArray(value)) { for (const child of value) pending.push({ value: child, depth }); continue; }
    const item = value as Record<string, unknown>;
    const collection = item.type === "block-map" || item.type === "block-seq" || item.type === "flow-collection";
    if (collection || ["alias", "scalar", "single-quoted-scalar", "double-quoted-scalar", "block-scalar"].includes(String(item.type))) {
      if (++composed > work.limits.maxParserNodes) throw new MikeError("yq limit exceeded: maxParserNodes");
      work.node();
    }
    work.depth(depth);
    if (item.type && ++nodes > work.limits.maxParserNodes * 8) throw new MikeError("yq limit exceeded: maxParserNodes");
    if (typeof item.source === "string") {
      bytes += Buffer.byteLength(item.source);
      if (bytes > work.limits.maxDocumentBytes) throw new MikeError("yq limit exceeded: maxDocumentBytes");
      if (item.source.length > work.limits.maxScalarBytes) throw new MikeError("yq limit exceeded: maxScalarBytes");
    }
    for (const child of Object.values(item)) if (child && typeof child === "object") pending.push({ value: child, depth: depth + (collection ? 1 : 0) });
  }
}

export async function decodeDocuments(text: string, filename: string, fileIndex: number, format: "yaml" | "json", yaml: YamlModule, work: NativeWork, onDocument?: (document: NativeDocument) => Promise<void>): Promise<NativeDocument[]> {
  const documents: NativeDocument[] = [];
  const position = (offset: number) => {
    const prefix = text.slice(0, offset);
    return { line: prefix.split("\n").length, column: offset - prefix.lastIndexOf("\n") };
  };
  const accept = async (doc: Document<Node>) => {
    work.assertOpen();
    const error = doc.errors.find(error => !(error.code === "MISSING_CHAR" && error.message === "Comments must be separated from other tokens by white space characters"));
    if (error) {
      let message = error.message;
      const start = position(doc.contents?.range?.[0] ?? doc.range?.[0] ?? 0);
      if (message.startsWith("Flow sequence") && message.includes("end with a ]")) message = `while parsing a flow node at line ${start.line}: did not find expected node content`;
      else if (message.startsWith("Missing closing") && message.includes("quote")) {
        const end = position(error.pos[0]);
        message = `while scanning a quoted scalar at line ${start.line}: line ${end.line}, column ${end.column}: found unexpected end of stream`;
      } else if (message === "Missing , or : between flow sequence items") message = `while parsing a flow sequence at <unknown position>: line ${start.line}: did not find expected ',' or ']'`;
      throw new MikeError(`bad file '${filename}': yaml: ${message}`);
    }
    work.document();
    if (!doc.contents) { const empty = new yaml.Scalar(null); empty.source = ""; work.node(); doc.contents = empty; }
    await inspectNode(doc.contents, yaml, work, true);
    const anchors = new Set<string>();
    const pending: Node[] = [doc.contents];
    while (pending.length) {
      await work.tick();
      const node = pending.pop()!;
      if ("anchor" in node && node.anchor) anchors.add(node.anchor);
      if (yaml.isAlias(node)) {
        work.alias();
        if (!anchors.has(node.source)) {
          const location = position((node.range?.[0] ?? 0) + 1);
          throw new MikeError(`bad file '${filename}': yaml: line ${location.line}, column ${location.column}: unknown anchor '${node.source}' referenced`);
        }
      } else if (yaml.isMap(node)) {
        for (let index = node.items.length - 1; index >= 0; index--) {
          const pair = node.items[index]!;
          if (yaml.isNode(pair.value)) pending.push(pair.value);
          if (yaml.isNode(pair.key)) pending.push(pair.key);
        }
      } else if (yaml.isSeq(node)) for (let index = node.items.length - 1; index >= 0; index--) if (yaml.isNode(node.items[index])) pending.push(node.items[index] as Node);
    }
    const document = { doc, filename, fileIndex, documentIndex: documents.length, format };
    documents.push(document);
    await onDocument?.(document);
  };
  if (format === "json") {
    let start = 0;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    let tokens = 0;
    const acceptJson = async (end: number) => {
      const source = text.slice(start, end).trim();
      start = end;
      if (!source) return;
      if (Buffer.byteLength(source) > work.limits.maxDocumentBytes) throw new MikeError("yq limit exceeded: maxDocumentBytes");
      let value: unknown;
      try { value = JSON.parse(source); }
      catch { throw new MikeError(`bad file '${filename}': invalid JSON input`); }
      const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
      let count = 0;
      while (pending.length) {
        const current = pending.pop()!;
        await work.tick(); work.depth(current.depth); work.node();
        if (++count > work.limits.maxParserNodes) throw new MikeError("yq limit exceeded: maxParserNodes");
        if (typeof current.value === "string" && Buffer.byteLength(current.value) > work.limits.maxScalarBytes) throw new MikeError("yq limit exceeded: maxScalarBytes");
        if (Array.isArray(current.value)) for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 });
        else if (current.value && typeof current.value === "object") for (const [key, child] of Object.entries(current.value)) pending.push({ value: key, depth: current.depth + 1 }, { value: child, depth: current.depth + 1 });
      }
      const doc = new yaml.Document<Node>();
      doc.contents = doc.createNode(value) as Node;
      await accept(doc);
    };
    for (let index = 0; index < text.length; index++) {
      if ((index & 255) === 0) await work.tick(256);
      const character = text[index]!;
      if (quoted) { if (escaped) escaped = false; else if (character === "\\") escaped = true; else if (character === '"') { quoted = false; if (depth === 0) await acceptJson(index + 1); } }
      else if (character === '"') quoted = true;
      else if (character === "{" || character === "[") { depth++; work.depth(depth); }
      else if (character === "}" || character === "]") { depth--; if (depth === 0) { await acceptJson(index + 1); tokens = 0; } }
      else if (/\s/u.test(character) && depth === 0) await acceptJson(index + 1);
      if (!quoted && ",:{}[]".includes(character) && ++tokens > work.limits.maxParserNodes) throw new MikeError("yq limit exceeded: maxParserNodes");
    }
    await acceptJson(text.length);
    return documents;
  }
  let documentBytes = 0;
  for (let offset = 0; offset < text.length;) {
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline + 1;
    if (end - offset > work.limits.maxScalarBytes) throw new MikeError("yq limit exceeded: maxScalarBytes");
    const line = text.slice(offset, end);
    if (/^(?:---|\.\.\.)(?:[ \t\r\n]|$)/u.test(line)) documentBytes = 0;
    documentBytes += Buffer.byteLength(line);
    if (documentBytes > work.limits.maxDocumentBytes) throw new MikeError("yq limit exceeded: maxDocumentBytes");
    await work.tick(line.length + 1);
    offset = end;
  }
  const lexer = new yaml.Lexer();
  const parser = new yaml.Parser();
  const composer = new yaml.Composer({ keepSourceTokens: true, intAsBigInt: true, uniqueKeys: false, merge: false, prettyErrors: false, logLevel: "silent" });
  const token = async (item: import("yaml").CST.Token) => {
    await admitCst(item, work);
    for (const doc of composer.next(item)) await accept(doc as Document<Node>);
  };
  for (let offset = 0; offset <= text.length; offset += 4096) {
    await work.tick(Math.min(4096, text.length - offset) + 1);
    const incomplete = offset + 4096 < text.length;
    for (const lexeme of lexer.lex(text.slice(offset, offset + 4096), incomplete)) {
      if (Buffer.byteLength(lexeme) > work.limits.maxScalarBytes) throw new MikeError("yq limit exceeded: maxScalarBytes");
      await work.tick();
      work.depth(parser.stack.length);
      for (const item of parser.next(lexeme)) await token(item);
    }
    if (!incomplete) break;
  }
  for (const item of parser.end()) await token(item);
  for (const doc of composer.end(documents.length === 0, text.length)) await accept(doc as Document<Node>);
  return documents;
}
