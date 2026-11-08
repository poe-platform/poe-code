import { OfficeError } from './errors.js';
import type { RetainedXmlDocument, RetainedXmlNode } from './retained-xml-document.js';
import { characters, equal, literal } from './retained-values.js';
import { readFramePropertyValues, textVerticalModes } from './text-frames.js';
import { dialects } from './validation-schema.js';

/** Admit properties without materializing arbitrarily padded integer tokens. */
export async function readRetainedFrameFormatting(document: RetainedXmlDocument, body: RetainedXmlNode) {
  const malformed = (): never => { throw new OfficeError('invalid-xml', 'Invalid text frame properties.', 'parse'); };
  let properties: RetainedXmlNode | undefined;
  for await (const node of document.children(body)) {
    if (node.kind !== 'element' || !await equal(document.raw(node.localName), literal('bodyPr'))) continue;
    let drawing = false;
    for (const dialect of dialects) if (await equal(document.namespace(node), literal(dialect.a))) drawing = true;
    if (drawing) { if (properties) malformed(); properties = node; }
  }
  const attributes: Record<string, string | null> = {};
  const enums: Record<string, readonly string[]> = { wrap: ['square', 'none'], anchor: ['t', 'ctr', 'b', 'just', 'dist'], vert: textVerticalModes };
  const numbers = ['lIns', 'rIns', 'tIns', 'bIns', 'numCol', 'rot'];
  if (properties) for await (const attribute of document.attributes(properties)) {
    if (!await equal(document.namespace(attribute), literal(''))) continue;
    for (const key of [...numbers, ...Object.keys(enums)]) {
      if (!await equal(document.raw(attribute.localName), literal(key))) continue;
      if (enums[key]) {
        let value: string | undefined;
        for (const token of enums[key]) if (await equal(document.text(attribute), literal(token))) value = token;
        if (value === undefined) malformed();
        attributes[key] = value!;
      } else {
        let phase: 'leading' | 'sign' | 'digits' | 'trailing' = 'leading', negative = false, digits = false, value = 0;
        for await (const character of characters(document.text(attribute))) {
          if (character.trim() === '') {
            if (phase === 'sign') malformed();
            if (phase === 'digits') phase = 'trailing';
          } else if (phase === 'leading' && (character === '+' || character === '-')) {
            negative = character === '-'; phase = 'sign';
          } else if (phase !== 'trailing' && character >= '0' && character <= '9') {
            phase = 'digits'; digits = true; value = value * 10 + Number(character);
            if (!Number.isSafeInteger(value)) malformed();
          } else malformed();
        }
        if (!digits) malformed();
        attributes[key] = `${negative ? '-' : ''}${value}`;
      }
      break;
    }
  }
  const fits: string[] = [];
  if (properties) for await (const child of document.children(properties)) {
    if (child.kind !== 'element' || !await equal(document.namespace(child), document.namespace(properties))) continue;
    for (const name of ['noAutofit', 'normAutofit', 'spAutoFit']) if (await equal(document.raw(child.localName), literal(name))) {
      if (fits.length) malformed(); fits.push(name);
    }
  }
  return readFramePropertyValues(key => attributes[key] ?? null, fits);
}
