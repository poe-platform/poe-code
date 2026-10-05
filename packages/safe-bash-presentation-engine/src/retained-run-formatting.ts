import { InvalidXmlError, OfficeError } from './errors.js';
import type { ByteSource } from './contracts.js';
import type { RetainedXmlDocument, RetainedXmlNode } from './retained-xml-document.js';
import { characters, equal, literal } from './retained-values.js';
import { readRetainedPropertyValue } from './retained-property-value.js';
import { validateTextRunOptions } from './text-runs.js';

/** Fixed-schema formatting, with arbitrary strings still owned by the document. */
export async function readRetainedRunFormatting(document: RetainedXmlDocument, run: RetainedXmlNode) {
  const fail = (message: string): never => { throw new OfficeError('invalid-xml', message, 'parse'); };
  async function* children(parent: RetainedXmlNode | undefined, local: string) {
    if (parent) for await (const node of document.children(parent)) if (node.kind === 'element' && await equal(document.namespace(node), document.namespace(parent)) && await equal(document.raw(node.localName), literal(local))) yield node;
  }
  async function first(parent: RetainedXmlNode | undefined, local: string) { for await (const node of children(parent, local)) return node; return undefined; }
  async function attribute(parent: RetainedXmlNode | undefined, local: string) {
    if (parent) for await (const node of document.attributes(parent)) if (await equal(document.namespace(node), literal('')) && await equal(document.raw(node.localName), literal(local))) return () => document.text(node);
    return null;
  }
  async function token(source: (() => ByteSource) | null, tokens: readonly string[]) { if (source) for (const value of tokens) if (await equal(source(), literal(value))) return value; return undefined; }
  let properties: RetainedXmlNode | undefined;
  for await (const node of children(run, 'rPr')) { if (properties) fail('Ambiguous run properties.'); properties = node; }
  const attr = (key: string) => attribute(properties, key);
  const child = (key: string) => first(properties, key);
  async function boolean(key: string) {
    const source = await attr(key); if (!source) return null;
    const value = await token(source, ['0', '1', 'false', 'true']); if (value === undefined) fail('Invalid run boolean.'); return value === '1' || value === 'true';
  }
  async function numeric(key: string, scale: number) {
    const source = await attr(key); if (!source) return null;
    let nonempty = false, whitespace = true;
    for await (const character of characters(source())) { nonempty = true; if (character.trim() !== '') { whitespace = false; break; } }
    const value = nonempty && whitespace ? 0 : await readRetainedPropertyValue('number', source(), () => {});
    if (typeof value !== 'number') return fail('Invalid run number.'); return value / scale;
  }
  const cs = await child('cs');
  async function fontNumber(key: string) {
    const source = await attribute(cs, key); if (!source) return null;
    let phase: 'leading' | 'sign' | 'digits' | 'trailing' = 'leading', digits = false;
    for await (const character of characters(source())) {
      if (character.trim() === '') { if (phase === 'sign') fail('Invalid complex-script font classification.'); if (phase === 'digits') phase = 'trailing'; }
      else if (phase === 'leading' && (character === '+' || character === '-')) phase = 'sign';
      else if (phase !== 'trailing' && character >= '0' && character <= '9') { digits = true; phase = 'digits'; }
      else fail('Invalid complex-script font classification.');
    }
    const value = await readRetainedPropertyValue('number', source(), () => {});
    if (!digits || typeof value !== 'number' || !Number.isInteger(value)) return fail('Invalid complex-script font classification.'); return value;
  }
  const charset = await fontNumber('charset'), pitch = await fontNumber('pitchFamily'), panoseSource = await attribute(cs, 'panose');
  let panose: string | null = null;
  if (panoseSource) {
    panose = ''; let trailing = false;
    for await (const character of characters(panoseSource())) {
      if (character.trim() === '') { if (panose) trailing = true; continue; }
      if (trailing || panose.length >= 20) fail('Invalid complex-script font classification.'); panose += character.toUpperCase();
    }
  }
  const classification = { complexScriptCharset: charset, complexScriptPitchFamily: pitch, complexScriptPanose: panose };
  try { validateTextRunOptions(classification); } catch { fail('Invalid complex-script font classification.'); }
  const rtl = await child('rtl'), rtlSource = await attribute(rtl, 'val');
  const transitional = await equal(document.namespace(run), literal('http://schemas.openxmlformats.org/drawingml/2006/main'));
  const direction = await token(rtlSource, transitional ? ['0', '1', 'false', 'true', 'on', 'off'] : ['0', '1', 'false', 'true']);
  if (rtlSource && direction === undefined) fail('Invalid run direction.');
  async function strike() {
    const source = await attr('strike');
    const mappings = { noStrike: 'none', sngStrike: 'single', dblStrike: 'double' };
    const key = await token(source, [...Object.keys(mappings), ...Object.getOwnPropertyNames(Object.prototype)]);
    if (key === undefined) return source;
    // Preserve the buffered reader's inherited-key JSON behavior as well.
    const value = (mappings as Record<string, unknown>)[key]; return typeof value === 'function' ? undefined : value;
  }
  async function percentage(source: (() => ByteSource) | null) {
    if (!source) throw new InvalidXmlError('Missing percentage value.');
    let phase: 'leading' | 'body' | 'trailing' = 'leading', digits = 0, dot = false, percent = false, invalid = false, count = 0;
    async function* numericSource(): ByteSource {
      for await (const character of characters(source!())) {
        if (' \t\r\n'.includes(character)) { if (phase === 'body') phase = 'trailing'; continue; }
        if (phase === 'trailing' || percent) invalid = true;
        phase = 'body';
        if (character === '%') { percent = true; continue; }
        if (count++ === 0 && (character === '+' || character === '-')) { yield* literal(character); continue; }
        if (character === '.' && !dot) dot = true;
        else if (character >= '0' && character <= '9') digits++; else invalid = true;
        yield* literal(character);
      }
    }
    const value = await readRetainedPropertyValue('number', numericSource(), () => {});
    if (invalid || !digits || (!percent && dot) || typeof value !== 'number') throw new InvalidXmlError('Invalid numeric XML token.');
    if (!percent && !Number.isSafeInteger(value)) throw new InvalidXmlError('XML integer exceeds the safe range.');
    return value / (percent ? 100 : 100000);
  }
  async function color(parent: RetainedXmlNode | undefined) {
    if (!parent) return null;
    const kinds = { hslClr: 'HSL', prstClr: 'PRESET', schemeClr: 'SCHEME', scrgbClr: 'SCRGB', srgbClr: 'RGB', sysClr: 'SYSTEM' };
    let node: RetainedXmlNode | undefined, kind: keyof typeof kinds | undefined;
    for await (const candidate of document.children(parent)) {
      if (candidate.kind !== 'element' || !await equal(document.namespace(candidate), document.namespace(parent))) continue;
      for (const key of Object.keys(kinds) as (keyof typeof kinds)[]) if (await equal(document.raw(candidate.localName), literal(key))) {
        if (node) throw new OfficeError('invalid-xml', 'Multiple color choices.', 'index'); node = candidate; kind = key;
      }
    }
    if (!node || !kind) return null;
    async function transform(local: string) {
      let found: RetainedXmlNode | undefined;
      for await (const value of children(node, local)) { if (found) throw new OfficeError('invalid-xml', 'Multiple brightness transforms.', 'index'); found = value; }
      return found ? percentage(await attribute(found, 'val')) : undefined;
    }
    const off = await transform('lumOff'), mod = await transform('lumMod');
    return { type: kinds[kind], rgb: kind === 'srgbClr' ? await attribute(node, 'val') : null, theme: kind === 'schemeClr' ? await attribute(node, 'val') : null, brightness: off ?? (mod === undefined ? 0 : mod - 1) };
  }
  return {
    eastAsiaFont: await attribute(await child('ea'), 'typeface'), complexScriptFont: await attribute(cs, 'typeface'), symbolFont: await attribute(await child('sym'), 'typeface'),
    ...classification, alternateLanguage: await attr('altLang'), rtl: rtl ? ['1', 'true', 'on'].includes(direction ?? '0') : null,
    font: await attribute(await child('latin'), 'typeface'), size: await numeric('sz', 100), language: await attr('lang'), bold: await boolean('b'), italic: await boolean('i'),
    underline: await attr('u'), strike: await strike(), baseline: await numeric('baseline', 1000), capitalization: await attr('cap'), spacing: await numeric('spc', 100),
    color: await color(await child('solidFill')), highlight: await color(await child('highlight'))
  };
}
