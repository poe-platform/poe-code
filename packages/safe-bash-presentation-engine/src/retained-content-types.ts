import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { ByteSource } from "./contracts.js";
import type { ContentTypeLimits, PresentationKind } from "./content-types.js";
import { OfficeError } from "./errors.js";
import { asciiKey, partName } from "./package-uri.js";
import type { RetainedPackageContext } from "./retained-package.js";
import { openRetainedXmlDocument, type RetainedXmlNode } from "./retained-xml-document.js";
import type { XmlRange } from "./retained-xml.js";
import { RetainedValues, literal, equal, characters, folded } from "./retained-values.js";
import { resourceContext } from "./resource-limits.js";

export interface RetainedContentTypes {
  get(part: string): Promise<ByteSource>;
  presentationKind(mainPart: string, expectedKind?: PresentationKind): Promise<PresentationKind>;
  close(): Promise<void>;
}
const mainKinds = [
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml', 'pptx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.template.main+xml', 'potx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml', 'ppsx']
] as const;
const namespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
const space = (value: string) => value === ' ' || value === '\t' || value === '\n' || value === '\r';
const alphanumeric = (code: number) => code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122;
const token = (value: string) => value.length === 1 && (alphanumeric(value.charCodeAt(0)) || "!#$%&'*+-.^_`|~".includes(value));
function invalid(): never { throw new OfficeError('invalid-opc', 'Invalid package content types.', 'index'); }
function unsafe(): never { throw new OfficeError('unsafe-path', 'Invalid package part name.', 'index'); }

/** Normalize manifest keys incrementally; a single unused override or default
 * can exceed ZIP filename lengths, so no per-scalar cap is introduced here. */
async function* keyBytes(source: ByteSource, isDefault: boolean): ByteSource {
  const encoder = new TextEncoder(); let buffer = '', position = 0, segment = 0, last = '', escape = '';
  for await (const character of characters(source)) {
    const code = character.codePointAt(0)!;
    if (!isDefault && position++ === 0) { if (character !== '/') unsafe(); buffer += '/'; continue; }
    if (escape) {
      if (!'0123456789abcdefABCDEF'.includes(character)) { if (isDefault) invalid(); unsafe(); }
      escape += character;
      if (escape.length === 3) {
        const byte = Number.parseInt(escape.slice(1), 16);
        if (!isDefault && (byte < 32 || byte >= 127 || byte === 47 || byte === 92 || alphanumeric(byte) || '-._~'.includes(String.fromCharCode(byte)))) unsafe();
        buffer += asciiKey(escape); escape = ''; segment++; last = '%';
      }
    } else if (character === '%') escape = '%';
    else if (!isDefault && character === '/') {
      if (!segment || last === '.') unsafe(); buffer += '/'; segment = 0; last = '';
    } else {
      const international = code >= 0xa0 && code <= 0xd7ff || code >= 0xf900 && code <= 0xfdcf || code >= 0xfdf0 && code <= 0xffef
        || code >= 0x10000 && code <= 0xefffd && (code & 0xffff) <= 0xfffd && (code < 0xe0000 || code >= 0xe1000);
      if (!(alphanumeric(code) || (isDefault ? "!$&'()*+,:=@-_~" : "!$&'()*+,;=:@-._~").includes(character) || !isDefault && international)) {
        if (isDefault) invalid(); unsafe();
      }
      buffer += asciiKey(character); segment++; last = character;
    }
    if (buffer.length >= 2048) { yield encoder.encode(buffer); buffer = ''; }
  }
  if (escape || !segment || !isDefault && last === '.') { if (isDefault) invalid(); unsafe(); }
  if (buffer) yield encoder.encode(buffer);
}

export async function openRetainedContentTypes(source: ByteSource, settings: RetainedPackageContext, limits: Partial<ContentTypeLimits> = {}): Promise<RetainedContentTypes> {
  const context = resourceContext(settings), working = { ...settings.workingStorage };
  const maxBytes = limits.maxBytes ?? Infinity, maxEntries = limits.maxEntries ?? Infinity;
  for (const value of [maxBytes, maxEntries]) if (value < 1 || value !== Infinity && !Number.isSafeInteger(value))
    throw new OfficeError('invalid-value', 'Invalid content-type limits.', 'usage');
  const doc = await openRetainedXmlDocument(source, { ...context, workingStorage: working, xmlLimits: { ...context.xmlLimits, maxBytes: Math.min(maxBytes, context.xmlLimits.maxBytes) } }).catch(error => {
    if (error instanceof OfficeError && error.code === 'invalid-xml') invalid();
    throw error;
  });
  const signal = context.signal ?? new AbortController().signal;
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, (working.cacheBytes ?? 1024 * 1024) / 16384);
  let closed = false, closing: Promise<void> | undefined, count = 0;
  const check = () => {
    if (closed) throw new OfficeError('invalid-handle', 'Content-type index is closed.', 'index');
    if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index');
  };
  const values = new RetainedValues(pages, check, signal);
  const failure = (error: unknown): unknown => error instanceof OfficeError ? error
    : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Content-type storage operation failed.', 'index');
  async function* read(range: XmlRange): ByteSource {
    try { yield* values.read(range); } catch (error) { throw failure(error); }
  }
  const close = () => {
    closed = true;
    return closing ??= (async () => {
      const outcomes = await Promise.allSettled([pages.close(), doc.close()]);
      const failed = outcomes.find(outcome => outcome.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    })();
  };
  const matches = (node: RetainedXmlNode, name: string) => equal(doc.raw(node.localName), literal(name));
  async function whitespace(node: RetainedXmlNode) {
    if (node.kind === 'comment' || node.kind === 'instruction') return;
    if (node.kind !== 'text') invalid();
    for await (const character of characters(doc.text(node))) if (!space(character)) invalid();
  }
  async function mediaType(type: XmlRange): Promise<void> {
    const encoder = new TextEncoder(), input = characters(values.read(type)); let character = '', position = 0;
    const current = (): string => character;
    const next = async () => { position += encoder.encode(character).length; character = (await input.next()).value ?? ''; };
    const readToken = async () => {
      const start = position;
      while (token(character)) await next();
      if (start === position) invalid();
      return { start: type.start + start, length: position - start };
    };
    try {
      await next(); await readToken(); if (current() !== '/') invalid(); await next(); await readToken();
      const essence = { start: type.start, length: position }; let parameters = false;
      while (character) {
        while (current() === ' ' || current() === '\t') await next();
        if (current() !== ';') invalid(); await next();
        while (current() === ' ' || current() === '\t') await next();
        const name = await readToken(), key = await values.store(folded(values.read(name)));
        if (!await values.insert(`p${count}`, key, key) || current() !== '=') invalid();
        parameters = true; await next();
        if (current() !== '"') await readToken();
        else {
          await next();
          for (;;) {
            if (!character) invalid();
            if (current() === '"') { await next(); break; }
            if (current() === '\\') { await next(); if (!character) invalid(); }
            const code = current().codePointAt(0)!;
            if (code < 32 && code !== 9 || code === 127 || code > 255) invalid();
            await next();
          }
        }
      }
      if (parameters) {
        const prefix = 'application/vnd.openxmlformats-package.';
        if (essence.length >= prefix.length && await equal(folded(values.read({ start: essence.start, length: prefix.length })), literal(prefix))) invalid();
        for (const [mime] of mainKinds) if (await equal(folded(values.read(essence)), literal(mime))) invalid();
      }
    } finally { await input.return(undefined); }
  }
  try {
    if (!await matches(doc.root, 'Types') || !await equal(doc.namespace(doc.root), literal(namespace))) invalid();
    for await (const ignoredAttribute of doc.attributes(doc.root)) invalid();
    for await (const node of doc.children(doc.root)) {
      check(); if (node.kind !== 'element') { await whitespace(node); continue; }
      if (++count > maxEntries) throw new OfficeError('resource-limit', 'Content-type entry limit exceeded.', 'index');
      const isDefault = await matches(node, 'Default');
      if (!isDefault && !await matches(node, 'Override') || !await equal(doc.namespace(node), literal(namespace))) invalid();
      let name: RetainedXmlNode | undefined, type: RetainedXmlNode | undefined;
      for await (const attribute of doc.attributes(node)) {
        if (!await equal(doc.namespace(attribute), literal(''))) invalid();
        if (await matches(attribute, isDefault ? 'Extension' : 'PartName')) name = attribute;
        else if (await matches(attribute, 'ContentType')) type = attribute;
        else invalid();
      }
      if (!name || !type) invalid();
      for await (const child of doc.children(node)) await whitespace(child);
      if (await equal(doc.text(name), literal('')) || await equal(doc.text(type), literal(''))
        || !isDefault && await equal(doc.text(name), literal('/[Content_Types].xml'))) invalid();
      const key = await values.store(keyBytes(doc.text(name), isDefault));
      const mime = await values.store(doc.text(type)); await mediaType(mime);
      if (!await values.insert(isDefault ? 'd' : 'o', key, mime)) invalid();
    }
    if (!count) invalid();
    await doc.close();
    const get = async (part: string): Promise<ByteSource> => {
      try {
      check(); if (typeof part !== 'string') throw new OfficeError('invalid-type', 'Expected a part URI string.', 'usage');
      const name = asciiKey(partName(part, false)); if (name === '/[content_types].xml') invalid();
      let found = await values.find('o', () => literal(name));
      if (!found) { const filename = name.slice(name.lastIndexOf('/') + 1), dot = filename.lastIndexOf('.'); if (dot >= 0) found = await values.find('d', () => literal(filename.slice(dot + 1))); }
      if (!found) throw new OfficeError('missing-binding', 'Part content type is absent.', 'index');
      return read(found);
      } catch (error) { throw failure(error); }
    };
    return Object.freeze({ get, close, async presentationKind(part: string, expected?: PresentationKind): Promise<PresentationKind> {
      for (const [mime, kind] of mainKinds) if (await equal(folded(await get(part)), literal(mime))) {
        if (expected !== undefined && expected !== kind) invalid(); return kind;
      }
      invalid();
    } });
  } catch (error) { await close().catch(() => {}); throw failure(error); }
}
