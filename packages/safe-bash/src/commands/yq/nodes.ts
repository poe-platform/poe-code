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

async function decodeJsonDocument(source: string, filename: string, yaml: YamlModule, work: NativeWork): Promise<Document<Node>> {
  let offset = 0;
  let nodes = 0;
  const admit = () => {
    if (++nodes > work.limits.maxParserNodes) throw new MikeError("yq limit exceeded: maxParserNodes");
    work.node();
  };
  const fail = (context?: string): never => { throw new MikeError(`bad file '${filename}': ${context ? `json: ${context} unexpected end of JSON input` : "invalid JSON input"}`); };
  const skip = async () => { while (offset < source.length && " \t\r\n".includes(source[offset]!)) { offset++; await work.tick(); } };
  const string = async (): Promise<string> => {
    const start = offset++;
    let escaped = false;
    while (offset < source.length) {
      await work.tick();
      const character = source[offset++]!;
      if (!escaped && character === '"') {
        let value: string;
        try { value = JSON.parse(source.slice(start, offset)) as string; } catch { return fail(); }
        if (Buffer.byteLength(value) > work.limits.maxScalarBytes) throw new MikeError("yq limit exceeded: maxScalarBytes");
        return Buffer.from(value).toString("utf8");
      }
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
    }
    return fail();
  };
  const parse = async (depth: number, context = "null"): Promise<Node> => {
    await skip(); await work.tick(); work.depth(depth);
    const character = source[offset];
    if (character === undefined) return fail(context === "value of object" ? "object of object" : context);
    admit();
    if (character === "{") {
      offset++;
      const node = new yaml.YAMLMap();
      await skip();
      if (source[offset] === "}") { offset++; return node; }
      for (;;) {
        if (source[offset] !== '"') return fail();
        admit();
        const key = new yaml.Scalar(await string());
        await skip();
        if (source[offset++] !== ":") return fail();
        const value = await parse(depth + 1, "value of object");
        node.items.push(new yaml.Pair(key, value));
        await skip();
        if (source[offset] === "}") { offset++; return node; }
        if (source[offset] === '"') continue;
        if (source[offset++] !== ",") return fail("object of object");
        await skip();
      }
    }
    if (character === "[") {
      offset++;
      const node = new yaml.YAMLSeq();
      await skip();
      if (source[offset] === "]") { offset++; return node; }
      for (;;) {
        node.items.push(await parse(depth + 1));
        await skip();
        if (source[offset] === "]") { offset++; return node; }
        if (source[offset++] !== ",") return fail();
        await skip();
      }
    }
    if (character === '"') return new yaml.Scalar(await string());
    if (character === "}" || character === "]" || character === ",") return fail(context);
    const start = offset;
    while (offset < source.length && !' \t\r\n,]}"'.includes(source[offset]!)) { offset++; await work.tick(); }
    let value: unknown;
    try { value = JSON.parse(source.slice(start, offset)); } catch { return fail(); }
    if (value !== null && typeof value !== "number" && typeof value !== "boolean") return fail();
    if (typeof value === "number" && Number.isFinite(value)) {
      if (Number.isInteger(value)) {
        const integer = BigInt(value);
        const clamped = integer < -(1n << 63n) ? -(1n << 63n) : integer >= 1n << 63n ? (1n << 63n) - 1n : integer;
        if (Number(clamped) === value) return new yaml.Scalar(clamped);
      }
      const node = new yaml.Scalar(value);
      const magnitude = Math.abs(value);
      node.source = (magnitude < 0.0001 || magnitude >= 1_000_000 ? value.toExponential() : String(value)).replace(/e([+-])([0-9])$/u, "e$10$2");
      node.tag = "tag:yaml.org,2002:float";
      work.implicitTags.add(node);
      return node;
    }
    return new yaml.Scalar(value);
  };
  const contents = await parse(0);
  await skip();
  if (offset !== source.length) fail();
  const doc = new yaml.Document<Node>();
  doc.contents = contents;
  return doc;
}

async function adaptQuotedIndent(text: string, filename: string, yaml: YamlModule, work: NativeWork): Promise<{ text: string; insertions: { offset: number; length: number }[]; failures: Map<number, string> }> {
  const additions: { offset: number; length: number }[] = [];
  const failures = new Map<number, string>();
  let size = Buffer.byteLength(text);
  let sourceOffset = 0;
  let quotedUntil = 0;
  const lexer = new yaml.Lexer();
  const closeQuote = async (start: number, limit: number): Promise<number> => {
    const quote = text[start];
    let escaped = false;
    for (let index = start + 1; index < limit; index++) {
      await work.tick();
      if (index - start > work.limits.maxScalarBytes) throw new MikeError("yq limit exceeded: maxScalarBytes");
      const character = text[index];
      if (character === "\n") {
        const marker = text.slice(index + 1, index + 4);
        const after = text[index + 4];
        if ((marker === "---" || marker === "...") && (after === undefined || " \t\r\n".includes(after))) {
          const line = text.slice(0, start).split("\n").length;
          const column = start - text.lastIndexOf("\n", start);
          const markerLine = text.slice(0, index + 1).split("\n").length;
          if (!failures.has(start)) work.node();
          failures.set(start, `bad file '${filename}': yaml: while scanning a quoted scalar at line ${line}, column ${column}: line ${markerLine}: found unexpected document indicator`);
          return -1;
        }
      }
      if (quote === '"') {
        if (!escaped && character === '"') return index + 1;
        if (!escaped && character === "\\") escaped = true;
        else escaped = false;
      } else if (character === "'") {
        if (text[index + 1] === "'") index++;
        else return index + 1;
      }
    }
    return -1;
  };
  scan: for (let offset = 0; offset <= text.length; offset += 4096) {
    const incomplete = offset + 4096 < text.length;
    await work.tick(Math.min(4096, text.length - offset) + 1);
    for (const lexeme of lexer.lex(text.slice(offset, offset + 4096), incomplete)) {
      await work.tick();
      if (lexeme === yaml.CST.DOCUMENT || lexeme === yaml.CST.FLOW_END || lexeme === yaml.CST.SCALAR) continue;
      const start = sourceOffset;
      sourceOffset += lexeme.length;
      if (start < quotedUntil || lexeme[0] !== '"' && lexeme[0] !== "'") continue;
      const closed = await closeQuote(start, sourceOffset);
      if (failures.size) break scan;
      if (closed >= 0) continue;
      const end = await closeQuote(start, text.length);
      if (failures.size) break scan;
      if (end < 0) continue;
      quotedUntil = end;
      const lineStart = text.lastIndexOf("\n", start) + 1;
      let indentation = 0;
      while (text[lineStart + indentation] === " ") { indentation++; await work.tick(); }
      for (let index = start; index < end; index++) {
        await work.tick();
        if (text[index] !== "\n") continue;
        let spaces = 0;
        while (text[index + 1 + spaces] === " ") { spaces++; await work.tick(); }
        if (spaces > indentation) continue;
        const length = indentation + 1 - spaces;
        if (length > work.limits.maxInputBytes - size) throw new MikeError("yq limit exceeded: maxInputBytes");
        work.node(3);
        additions.push({ offset: index + 1, length });
        size += length;
      }
    }
    if (!incomplete) break;
  }
  if (!additions.length) return { text, insertions: [], failures };
  const chunks: string[] = [];
  const insertions: { offset: number; length: number }[] = [];
  let copied = 0;
  let inserted = 0;
  for (const addition of additions) {
    await work.tick(addition.length + 1);
    chunks.push(text.slice(copied, addition.offset), " ".repeat(addition.length));
    insertions.push({ offset: addition.offset + inserted, length: addition.length });
    copied = addition.offset;
    inserted += addition.length;
  }
  chunks.push(text.slice(copied));
  return { text: chunks.join(""), insertions, failures };
}

export async function decodeDocuments(text: string, filename: string, fileIndex: number, format: "yaml" | "json", yaml: YamlModule, work: NativeWork, onDocument?: (document: NativeDocument) => Promise<void>): Promise<NativeDocument[]> {
  const documents: NativeDocument[] = [];
  const originalText = text;
  let insertions: { offset: number; length: number }[] = [];
  let quotedFailures = new Map<number, string>();
  const originalOffset = (offset: number) => {
    let added = 0;
    for (const insertion of insertions) { if (insertion.offset >= offset) break; added += Math.min(insertion.length, offset - insertion.offset); }
    return offset - added;
  };
  const position = (offset: number) => {
    const index = originalOffset(offset);
    const prefix = originalText.slice(0, index);
    return { line: prefix.split("\n").length, column: index - prefix.lastIndexOf("\n") };
  };
  const accept = async (doc: Document<Node>) => {
    work.assertOpen();
    const startOffset = originalOffset(doc.range?.[0] ?? 0);
    const endOffset = originalOffset(doc.range?.[2] ?? text.length);
    for (const [offset, failure] of quotedFailures) if (offset >= startOffset && offset < endOffset) throw new MikeError(failure);
    const error = doc.errors.find(error => !(error.code === "MISSING_CHAR" && error.message === "Comments must be separated from other tokens by white space characters"));
    if (error) {
      let message = error.message;
      const start = position(doc.contents?.range?.[0] ?? doc.range?.[0] ?? 0);
      if (message.startsWith("Flow sequence") && message.includes("end with a ]")) message = `while parsing a flow node at line ${start.line}: did not find expected node content`;
      else if (message.startsWith("Missing closing") && message.includes("quote")) {
        const end = position(error.pos[0]);
        message = `while scanning a quoted scalar at line ${start.line}: line ${end.line}, column ${end.column}: found unexpected end of stream`;
      } else if (message === "Missing , or : between flow sequence items") message = `while parsing a flow sequence at <unknown position>: line ${start.line}: did not find expected ',' or ']'`;
      else if (error.code === "MULTILINE_IMPLICIT_KEY") {
        let colon = error.pos[1];
        while (text[colon] === " " || text[colon] === "\t") { colon++; await work.tick(); }
        const location = position(colon);
        message = `line ${location.line}, column ${location.column}: mapping values are not allowed in this context`;
      }
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
      const doc = await decodeJsonDocument(source, filename, yaml, work);
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
  const admitText = async (input: string) => {
    let documentBytes = 0;
    for (let offset = 0; offset < input.length;) {
      const newline = input.indexOf("\n", offset);
      const end = newline < 0 ? input.length : newline + 1;
      if (end - offset > work.limits.maxScalarBytes) throw new MikeError("yq limit exceeded: maxScalarBytes");
      const line = input.slice(offset, end);
      if (/^(?:---|\.\.\.)(?:[ \t\r\n]|$)/u.test(line)) documentBytes = 0;
      documentBytes += Buffer.byteLength(line);
      if (documentBytes > work.limits.maxDocumentBytes) throw new MikeError("yq limit exceeded: maxDocumentBytes");
      await work.tick(line.length + 1);
      offset = end;
    }
  };
  await admitText(text);
  const adapted = await adaptQuotedIndent(text, filename, yaml, work);
  quotedFailures = adapted.failures;
  if (adapted.text !== text) { await admitText(adapted.text); text = adapted.text; insertions = adapted.insertions; }
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
