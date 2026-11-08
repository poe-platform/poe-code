import { OfficeError } from './errors.js';
import type { ByteSource } from './contracts.js';
import type { RetainedXmlDocument, RetainedXmlNode } from './retained-xml-document.js';
import { characters, equal, literal } from './retained-values.js';
import { readRetainedPropertyValue } from './retained-property-value.js';
import { paragraphAlignments } from './text-paragraphs.js';

/** Direct paragraph formatting; tab rows and arbitrary attribute strings stream. */
export async function readRetainedParagraphFormatting(document: RetainedXmlDocument, paragraph: RetainedXmlNode) {
  async function local(node: RetainedXmlNode, keys: readonly string[]) { for (const key of keys) if (await equal(document.raw(node.localName), literal(key))) return key; return undefined; }
  async function* children(parent: RetainedXmlNode | undefined, keys: readonly string[]) {
    if (parent) for await (const node of document.children(parent)) if (node.kind === 'element' && await equal(document.namespace(node), document.namespace(parent)) && await local(node, keys)) yield node;
  }
  async function first(parent: RetainedXmlNode | undefined, keys: readonly string[]) { for await (const node of children(parent, keys)) return node; return undefined; }
  async function attr(parent: RetainedXmlNode | undefined, key: string) {
    if (parent) for await (const node of document.attributes(parent)) if (await equal(document.namespace(node), literal('')) && await local(node, [key])) return () : ByteSource => document.text(node);
    return null;
  }
  let properties: RetainedXmlNode | undefined;
  for await (const node of children(paragraph, ['pPr'])) { if (properties) throw new OfficeError('invalid-xml', 'Ambiguous paragraph properties.', 'parse'); properties = node; }
  async function numeric(source: (() => ByteSource) | null, scale: number) {
    if (!source) return null;
    const value = await readRetainedPropertyValue('number', source(), () => {});
    if (typeof value !== 'number') throw new OfficeError('invalid-xml', 'Invalid paragraph number.', 'parse'); return value / scale;
  }
  async function spacing(key: string) {
    const parent = await first(properties, [key]), node = await first(parent, ['spcPts', 'spcPct']);
    if (!node) return null;
    const source = await attr(node, 'val'); if (!source) return null;
    if (await local(node, ['spcPts'])) return { unit: 'pt', value: await numeric(source, 100) };
    let last = -1; for await (const bytes of source()) if (bytes.length) last = bytes[bytes.length - 1]!;
    async function* withoutPercent(): ByteSource {
      let pending: Uint8Array | undefined;
      for await (const bytes of source!()) if (bytes.length) { if (pending) yield pending; pending = new Uint8Array(bytes); }
      if (pending) yield pending.subarray(0, pending.length - 1);
    }
    return { unit: 'multiple', value: await numeric(last === 37 ? withoutPercent : source, last === 37 ? 100 : 100000) };
  }
  const bulletNode = await first(properties, ['buNone', 'buChar', 'buAutoNum', 'buBlip']);
  async function bullet() {
    if (!bulletNode) return null;
    const kind = await local(bulletNode, ['buNone', 'buChar', 'buAutoNum', 'buBlip']);
    if (kind === 'buNone') return { kind: 'none' };
    if (kind === 'buChar') return { kind: 'character', character: await attr(bulletNode, 'char') };
    if (kind !== 'buAutoNum') return { kind: 'picture' };
    const start = await attr(bulletNode, 'startAt');
    let startAt: number | null = null;
    if (start) {
      let whitespace = true; for await (const character of characters(start())) if (character.trim() !== '') { whitespace = false; break; }
      // Native Number permits empty/whitespace input. Its nonfinite results
      // serialize to null, unlike validated paragraph numeric attributes.
      startAt = whitespace ? 0 : await readRetainedPropertyValue('number', start(), () => {}) as number | null;
    }
    return { kind: 'numbered', scheme: await attr(bulletNode, 'type'), ...(start ? { startAt } : {}) };
  }
  const bulletValue = await bullet(), before = await spacing('spcBef'), after = await spacing('spcAft');
  const align = await attr(properties, 'algn'), rtl = await attr(properties, 'rtl');
  let direction: boolean | null = null;
  if (rtl) {
    let valid = false;
    for (const value of ['0', '1', 'false', 'true']) if (await equal(rtl(), literal(value))) { direction = value === '1' || value === 'true'; valid = true; break; }
    if (!valid) throw new OfficeError('invalid-xml', 'Invalid paragraph direction.', 'parse');
  }
  let alignment: string | (() => ByteSource) | null = align;
  if (align) for (const [index, key] of ['l', 'ctr', 'r', 'just', 'dist', 'thaiDist', 'justLow'].entries()) if (await equal(align(), literal(key))) { alignment = paragraphAlignments[index]!; break; }
  const marginLeft = await numeric(await attr(properties, 'marL'), 12700), marginRight = await numeric(await attr(properties, 'marR'), 12700), indent = await numeric(await attr(properties, 'indent'), 12700), defaultTabSize = await numeric(await attr(properties, 'defTabSz'), 12700), level = await numeric(await attr(properties, 'lvl'), 1), lineSpacing = await spacing('lnSpc');
  const tabList = await first(properties, ['tabLst']);
  async function* tabs() {
    for await (const node of children(tabList, ['tab'])) {
      const position = await numeric(await attr(node, 'pos'), 12700), source = await attr(node, 'algn');
      let alignment: unknown = source ?? 'left';
      const mappings = { l: 'left', ctr: 'center', r: 'right', dec: 'decimal' };
      if (source) for (const key of [...Object.keys(mappings), ...Object.getOwnPropertyNames(Object.prototype)]) if (await equal(source(), literal(key))) {
        const value = (mappings as Record<string, unknown>)[key]; alignment = typeof value === 'function' ? undefined : value; break;
      }
      yield { position, alignment };
    }
  }
  return { alignment, marginLeft, marginRight, indent, defaultTabSize, level, rtl: direction, lineSpacing, spaceBefore: before?.unit === 'pt' ? before.value : null, spaceAfter: after?.unit === 'pt' ? after.value : null, bullet: bulletValue, tabs: tabList ? tabs() : null };
}
