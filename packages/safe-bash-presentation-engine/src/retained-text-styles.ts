import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import { openRetainedXmlDocument, type RetainedXmlDocument, type RetainedXmlNode } from './retained-xml-document.js';
import { equal, literal, characters } from './retained-values.js';
import type { RetainedPackageContext } from './retained-package.js';
import { resourceContext } from './resource-limits.js';
import type { EffectiveStyleValue, TextStyleRecord } from './text-style-resolution.js';

type Scalar = () => ByteSource;
export interface RetainedStyleInput { readonly part: string; source(): ByteSource }
/** Overrides are ordered by their owning inheritance layer. The shipped engine
 * has one override relationship per slide, layout and master. */
export interface RetainedTextStyleContext {
  readonly slide: RetainedStyleInput;
  readonly layout?: RetainedStyleInput;
  readonly master?: RetainedStyleInput;
  readonly presentation?: RetainedStyleInput;
  readonly theme?: RetainedStyleInput;
  readonly slideTheme?: RetainedStyleInput;
  readonly layoutTheme?: RetainedStyleInput;
  readonly masterTheme?: RetainedStyleInput;
}
export interface RetainedStyleSource { readonly part: string; readonly layer: string; path(): ByteSource }
export interface RetainedStyleValue extends Omit<EffectiveStyleValue, 'value' | 'token' | 'source' | 'references'> {
  readonly value: Scalar | number | boolean | null;
  readonly token: Scalar | null;
  readonly source: RetainedStyleSource | null;
  readonly references: readonly RetainedStyleSource[];
}
export interface RetainedTextStyleRecord extends Omit<TextStyleRecord, 'shapeId' | 'properties'> {
  shapeId(): ByteSource;
  readonly properties: Readonly<Record<keyof TextStyleRecord['properties'], RetainedStyleValue>>;
}
export interface RetainedTextStyles { records(): AsyncGenerator<RetainedTextStyleRecord>; close(): Promise<void> }
type Node = { doc: RetainedXmlDocument; node: RetainedXmlNode };
type Part = { part: string; root: Node; shapes: number };
type Layer = { node: Node; source: RetainedStyleSource; fontReference?: boolean };
const attributes: Record<string, string> = { bold: 'b', italic: 'i', size: 'sz', language: 'lang', underline: 'u', strike: 'strike', baseline: 'baseline', capitalization: 'cap', spacing: 'spc' };
const fonts: Record<string, string> = { latin: 'latin', eastAsia: 'ea', complex: 'cs' };
const enums: Record<string, readonly string[]> = {
  underline: ['none', 'words', 'sng', 'dbl', 'heavy', 'dotted', 'dottedHeavy', 'dash', 'dashHeavy', 'dashLong', 'dashLongHeavy', 'dotDash', 'dotDashHeavy', 'dotDotDash', 'dotDotDashHeavy', 'wavy', 'wavyHeavy', 'wavyDbl'],
  strike: ['noStrike', 'sngStrike', 'dblStrike'], capitalization: ['none', 'small', 'all']
};
const properties = ['bold', 'italic', 'size', 'latin', 'eastAsia', 'complex', 'color', 'language', 'underline', 'strike', 'baseline', 'capitalization', 'spacing', 'highlight'] as const;

/** Admit one slide's complete inheritance context. Scalar results borrow the
 * owned XML stores until close. Only fixed-count layers/properties live in RAM;
 * shape traversal and lists use caller storage. Admission validates all records
 * before exposing replayable, read-only result iterators. */
export async function openRetainedTextStyles(input: RetainedTextStyleContext, settings: RetainedPackageContext): Promise<RetainedTextStyles> {
  const context = resourceContext(settings), working = { ...settings.workingStorage }, cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!working.fs || typeof working.directory !== 'string' || !working.directory.startsWith('/') || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384)
    throw new OfficeError('invalid-value', 'Explicit style storage and a valid cache budget are required.', 'usage');
  const signal = context.signal ?? new AbortController().signal;
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  const keys = ['slide', 'layout', 'master', 'presentation', 'theme', 'slideTheme', 'layoutTheme', 'masterTheme'] as const;
  const sources = keys.map(key => input[key] ? { part: input[key]!.part, source: input[key]!.source.bind(input[key]) } : undefined);
  const parts: Partial<Record<(typeof keys)[number], Part>> = {}, documents: RetainedXmlDocument[] = [];
  let closed = false, closing: Promise<void> | undefined;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Text styles are closed.', 'index'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index'); };
  const failure = (error: unknown) => error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Style storage operation failed.', 'index');
  const close = () => { closed = true; return closing ??= (async () => {
    const results = await Promise.allSettled([...documents.map(doc => doc.close()), pages.close()]);
    for (const result of results) if (result.status === 'rejected') throw failure(result.reason);
  })(); };
  function scalar(...segments: (string | Scalar)[]): Scalar { return async function* () { check(); for (const segment of segments) { check(); yield* typeof segment === 'string' ? literal(segment) : segment(); } }; }
  const rawName = (node: Node): Scalar => scalar(() => node.doc.raw(node.node.localName));
  async function is(node: Node, name: string | Scalar, ns?: Scalar) {
    return node.node.kind === 'element' && await equal(rawName(node)(), typeof name === 'string' ? literal(name) : name()) && (!ns || await equal(node.doc.namespace(node.node), ns()));
  }
  async function attr(node: Node | undefined, name: string | Scalar): Promise<Scalar | undefined> {
    if (!node) return undefined;
    for await (const item of node.doc.attributes(node.node)) if (await equal(node.doc.namespace(item), literal('')) && await equal(node.doc.raw(item.localName), typeof name === 'string' ? literal(name) : name())) return scalar(() => node.doc.text(item));
    return undefined;
  }
  async function* children(node: Node | undefined, name?: string | Scalar, ns?: Scalar): AsyncGenerator<Node> {
    if (!node) return;
    for await (const item of node.doc.children(node.node)) {
      const child = { doc: node.doc, node: item }; if (item.kind !== 'element') continue;
      if (name === undefined || await is(child, name, ns ?? (() => node.doc.namespace(node.node)))) yield child;
    }
  }
  async function one(node: Node | undefined, name: string | Scalar, ns?: Scalar) {
    let found: Node | undefined;
    for await (const child of children(node, name, ns)) { if (found) throw new OfficeError('invalid-xml', 'Ambiguous style structure.', 'index'); found = child; }
    return found;
  }
  async function first(node: Node | undefined, ns: Scalar) {
    for await (const child of children(node)) if (await equal(child.doc.namespace(child.node), ns())) return child;
    return undefined;
  }
  async function hasChildren(node: Node) { for await (const ignoredChild of children(node)) return true; return false; }
  async function small(value: Scalar | undefined, limit = 32): Promise<string | undefined> {
    if (!value) return undefined; let text = '';
    for await (const character of characters(value())) { text += character; if (text.length > limit) return undefined; }
    return text;
  }
  async function nonempty(value: Scalar | undefined) { if (!value) return false; for await (const bytes of value()) if (bytes.length) return true; return false; }
  async function number(value: Scalar, signed: boolean, maximum: number): Promise<number | undefined> {
    let n = 0, negative = false, started = false, digits = false;
    for await (const c of characters(value())) {
      if (!started && signed && (c === '+' || c === '-')) { negative = c === '-'; started = true; continue; }
      started = true; if (c < '0' || c > '9') return undefined;
      digits = true; n = n * 10 + Number(c); if (n > maximum) return undefined;
    }
    return digits ? negative ? -n : n : undefined;
  }
  async function save(next: number, ref: number) { check(); const pointer = pages.allocate(16), bytes = new Uint8Array(16), view = new DataView(bytes.buffer); view.setFloat64(0, next, true); view.setFloat64(8, ref, true); await pages.write(pointer, bytes); return pointer; }
  async function load(pointer: number) { check(); const bytes = await pages.read(pointer, 16), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return [view.getFloat64(0, true), view.getFloat64(8, true)] as const; }
  async function indexShapes(part: Part) {
    let stack = 0, found = 0;
    const push = async (parent: Node | undefined) => { for await (const child of children(parent)) stack = await save(stack, child.doc.reference(child.node)); };
    await push(await one(await one(part.root, 'cSld'), 'spTree'));
    while (stack) {
      const [next, ref] = await load(stack); stack = next;
      const node = { doc: part.root.doc, node: await part.root.doc.node(ref) };
      if (!await equal(node.doc.namespace(node.node), part.root.doc.namespace(part.root.node))) continue;
      if (await is(node, 'sp')) found = await save(found, ref);
      if (await is(node, 'grpSp')) await push(node);
    }
    part.shapes = found;
  }
  async function* shapes(part: Part | undefined) { if (!part) return; if (part.shapes === -1) await indexShapes(part); for (let pointer = part.shapes; pointer;) { const [next, ref] = await load(pointer); yield { doc: part.root.doc, node: await part.root.doc.node(ref) }; pointer = next; } }
  async function placeholder(shape: Node | undefined) { return one(await one(await one(shape, 'nvSpPr'), 'nvPr'), 'ph'); }
  async function shapeId(shape: Node | undefined) { return await attr(await one(await one(shape, 'nvSpPr'), 'cNvPr'), 'id') ?? scalar(''); }
  async function match(part: Part | undefined, field: string, value: Scalar, fallback: string) {
    let found: Node | undefined;
    for await (const shape of shapes(part)) { const ph = await placeholder(shape); if (ph && await equal((await attr(ph, field) ?? scalar(fallback))(), value())) {
      if (found) throw new OfficeError('ambiguous-selection', 'Ambiguous style placeholder.', 'index'); found = shape;
    } }
    return found;
  }
  async function baseType(value: Scalar) {
    const type = await small(value); return type === 'ctrTitle' ? scalar('title') : type && ['subTitle', 'obj', 'chart', 'tbl', 'clipArt', 'dgm', 'media', 'pic'].includes(type) ? scalar('body') : value;
  }
  function source(part: Part, layer: string, path: Scalar): RetainedStyleSource { return Object.freeze({ part: part.part, layer, path }); }
  let drawing: Scalar;
  async function scheme(name: string) {
    for (const part of [parts.slideTheme, parts.layoutTheme, parts.masterTheme, parts.theme]) if (part) {
      const container = await is(part.root, 'themeOverride') ? part.root : await one(part.root, 'themeElements', drawing), node = await one(container, name, drawing);
      if (node) return { part, node };
    }
    return undefined;
  }
  async function resolve(layers: readonly Layer[], property: string): Promise<RetainedStyleValue> {
    const absent: RetainedStyleValue = { value: null, token: null, status: 'absent', source: null, references: Object.freeze([]), reason: null };
    for (const layer of layers) {
      const attribute = attributes[property], font = fonts[property];
      const fill = layer.fontReference ? property === 'highlight' ? undefined : layer.node : await one(layer.node, property === 'highlight' ? 'highlight' : 'solidFill', drawing);
      const color = await first(fill, drawing);
      let token: Scalar | undefined;
      if (layer.fontReference) {
        if (font) {
          const idx = await small(await attr(layer.node, 'idx')), prefix = idx === 'major' ? '+mj' : idx === 'minor' ? '+mn' : undefined;
          if (prefix) token = scalar(`${prefix}-${{ latin: 'lt', ea: 'ea', cs: 'cs' }[font]}`);
        } else if (!attribute && color) token = await attr(color, 'val') ?? rawName(color);
      } else token = attribute ? await attr(layer.node, attribute) : font ? await attr(await one(layer.node, font, drawing), 'typeface') : color ? await attr(color, 'val') ?? rawName(color) : undefined;
      if (property === 'color' && !color && !layer.fontReference) for await (const child of children(layer.node)) {
        if (await equal(child.doc.namespace(child.node), drawing()) && ['noFill', 'gradFill', 'pattFill', 'blipFill', 'grpFill'].includes(await small(rawName(child)) ?? ''))
          return Object.freeze({ ...absent, token: rawName(child), status: 'unresolved', source: layer.source, reason: 'non-solid-color' });
      }
      if (!token) continue;
      const references: RetainedStyleSource[] = [];
      const result = (value: RetainedStyleValue['value'], reason: string | null = null): RetainedStyleValue => Object.freeze({ value, token: token!, source: layer.source, status: reason ? 'unresolved' : 'resolved', references: Object.freeze(references), reason });
      if (attribute) {
        if (property === 'language') return await nonempty(token) ? result(token) : result(null, 'invalid-language');
        if (enums[property]) { const value = await small(token); return value !== undefined && enums[property]!.includes(value) ? result(property === 'strike' ? scalar({ noStrike: 'none', sngStrike: 'single', dblStrike: 'double' }[value]!) : token) : result(null, 'invalid-character-format'); }
        if (property === 'baseline' || property === 'spacing') { const value = await number(token, true, property === 'baseline' ? 100000 : 400000); return value === undefined ? result(null, 'invalid-character-format') : result(value / (property === 'baseline' ? 1000 : 100)); }
        if (property !== 'size') { const value = await small(token, 5); return value !== undefined && ['0', '1', 'true', 'false'].includes(value) ? result(value === '1' || value === 'true') : result(null, 'invalid-boolean'); }
        const value = await number(token, false, 400000); return value !== undefined && value >= 100 ? result(value / 100) : result(null, 'invalid-font-size');
      }
      if (font) {
        let plus = false; for await (const character of characters(token())) { plus = character === '+'; break; }
        if (!plus) return result(token);
        const variants: Record<string, readonly [string, string]> = { '+mj-lt': ['majorFont', 'latin'], '+mn-lt': ['minorFont', 'latin'], '+mj-ea': ['majorFont', 'ea'], '+mn-ea': ['minorFont', 'ea'], '+mj-cs': ['majorFont', 'cs'], '+mn-cs': ['minorFont', 'cs'] };
        const variant = variants[await small(token, 6) ?? ''], selected = await scheme('fontScheme');
        if (!variant || !selected) return result(null, 'theme-font-unavailable');
        references.push(source(selected.part, 'theme', scalar(`fontScheme/${variant.join('/')}`)));
        const value = await attr(await one(await one(selected.node, variant[0], drawing), variant[1], drawing), 'typeface');
        return value && await nonempty(value) ? result(value) : result(null, 'theme-font-unavailable');
      }
      if (!color) return result(null, 'color-unavailable');
      if (await hasChildren(color)) return result(null, 'color-transform');
      let resolved = color;
      if (await is(color, 'schemeClr')) {
        let slot = token, mapping: { part: Part; node: Node } | undefined;
        for (const part of [parts.slide, parts.layout]) if (part) {
          const override = await one(part.root, 'clrMapOvr'), map = await one(override, 'overrideClrMapping', drawing);
          if (map) { mapping = { part, node: map }; break; }
          if (await one(override, 'masterClrMapping', drawing)) break;
        }
        if (!mapping && parts.master) { const map = await one(parts.master.root, 'clrMap'); if (map) mapping = { part: parts.master, node: map }; }
        if (mapping) { slot = await attr(mapping.node, token) ?? token; references.push(source(mapping.part, 'color-map', scalar(rawName(mapping.node), '/@', token))); }
        const selected = await scheme('clrScheme'), entry = selected ? await one(selected.node, slot, drawing) : undefined, candidate = await first(entry, drawing);
        if (!selected || !candidate) return result(null, 'theme-color-unavailable');
        references.push(source(selected.part, 'theme', scalar('clrScheme/', slot))); resolved = candidate;
      }
      if (await hasChildren(resolved)) return result(null, 'color-transform');
      if (!await is(resolved, 'srgbClr')) return result(null, 'color-kind-unavailable');
      const rgb = await small(await attr(resolved, 'val'), 6);
      return rgb?.length === 6 && [...rgb.toUpperCase()].every(c => '0123456789ABCDEF'.includes(c)) ? result(scalar(rgb.toUpperCase())) : result(null, 'invalid-rgb');
    }
    return Object.freeze({ ...absent, references: Object.freeze([]) });
  }
  async function* records(): AsyncGenerator<RetainedTextStyleRecord> {
    try {
      check(); const slide = parts.slide!;
      for await (const shape of shapes(slide)) {
        const id = await shapeId(shape), ph = await placeholder(shape);
        const layoutShape = ph ? await match(parts.layout, 'idx', await attr(ph, 'idx') ?? scalar('0'), '0') : undefined;
        const type = await attr(await placeholder(layoutShape), 'type') ?? await attr(ph, 'type') ?? scalar('obj'), base = await baseType(type);
        const masterShape = ph ? await match(parts.master, 'type', base, 'obj') : undefined;
        const body = await one(shape, 'txBody'); let paragraph = 0;
        for await (const node of children(body, 'p', drawing)) {
          const pPr = await one(node, 'pPr', drawing), rawLevel = await small(await attr(pPr, 'lvl') ?? scalar('0'), 1);
          if (rawLevel === undefined || rawLevel.length !== 1 || !'012345678'.includes(rawLevel)) throw new OfficeError('invalid-xml', 'Invalid paragraph level.', 'index');
          const level = Number(rawLevel) + 1;
          async function* runs(): AsyncGenerator<Node | undefined> {
            let found = false;
            for await (const child of children(node)) if (await equal(child.doc.namespace(child.node), drawing()) && ['r', 'fld', 'br'].includes(await small(rawName(child)) ?? '')) { found = true; yield child; }
            if (!found) yield undefined;
          }
          let run = 0;
          for await (const runNode of runs()) {
            const layers: Layer[] = [];
            const add = (node: Node | undefined, part: Part | undefined, layer: string, path: Scalar, fontReference = false) => { if (node && part) layers.push({ node, source: source(part, layer, path), fontReference }); };
            const path = scalar('shape[', id, `]/p[${paragraph}]`);
            add(await one(runNode, 'rPr', drawing), slide, 'run', scalar(path, `/run[${run}]/rPr`));
            if (!runNode) add(await one(node, 'endParaRPr', drawing), slide, 'paragraph', scalar(path, '/endParaRPr'));
            add(await one(pPr, 'defRPr', drawing), slide, 'paragraph', scalar(path, '/pPr/defRPr'));
            for (const [owner, part, layer] of [[shape, slide, 'shape'], [layoutShape, parts.layout, 'layout'], [masterShape, parts.master, 'master']] as const) {
              const list = await one(await one(owner, 'txBody'), 'lstStyle', drawing);
              for (const key of [`lvl${level}pPr`, 'defPPr']) add(await one(await one(list, key, drawing), 'defRPr', drawing), part, layer, scalar('shape[', await shapeId(owner), `]/lstStyle/${key}/defRPr`));
            }
            const kind = ph && await equal(base(), literal('title')) ? 'titleStyle' : ph && await equal(base(), literal('body')) ? 'bodyStyle' : 'otherStyle';
            const masterStyle = await one(await one(parts.master?.root, 'txStyles'), kind);
            for (const key of [`lvl${level}pPr`, 'defPPr']) add(await one(await one(masterStyle, key, drawing), 'defRPr', drawing), parts.master, 'master-text', scalar(`txStyles/${kind}/${key}/defRPr`));
            for (const key of [`lvl${level}pPr`, 'defPPr']) add(await one(await one(await one(parts.presentation?.root, 'defaultTextStyle'), key, drawing), 'defRPr', drawing), parts.presentation, 'presentation', scalar(`defaultTextStyle/${key}/defRPr`));
            for (const [owner, part] of [[shape, slide], [layoutShape, parts.layout], [masterShape, parts.master]] as const) {
              const reference = await one(await one(owner, 'style'), 'fontRef', drawing);
              add(reference, part, 'font-reference', scalar('shape[', await shapeId(owner), ']/style/fontRef'), true);
            }
            const resolved = {} as Record<keyof TextStyleRecord['properties'], RetainedStyleValue>;
            for (const property of properties) resolved[property] = await resolve(layers, property);
            yield Object.freeze({ part: slide.part, shapeId: id, paragraph, run: runNode ? run : null, properties: Object.freeze(resolved) }); run++;
          }
          paragraph++;
        }
      }
    } catch (error) { throw failure(error); }
  }
  try {
    for (const [index, key] of keys.entries()) {
      const input = sources[index]; if (!input) continue;
      const doc = await openRetainedXmlDocument(input.source(), { ...context, workingStorage: working }); documents.push(doc);
      parts[key] = { part: input.part, root: { doc, node: doc.root }, shapes: -1 };
    }
    if (!parts.slide) throw new OfficeError('invalid-value', 'A slide style source is required.', 'usage');
    drawing = scalar(await equal(parts.slide.root.doc.namespace(parts.slide.root.node), literal('http://purl.oclc.org/ooxml/presentationml/main')) ? 'http://purl.oclc.org/ooxml/drawingml/main' : 'http://schemas.openxmlformats.org/drawingml/2006/main');
    for await (const ignoredRecord of records()) { check(); }
    return Object.freeze({ records, close });
  } catch (error) { await close().catch(() => {}); throw failure(error); }
}
