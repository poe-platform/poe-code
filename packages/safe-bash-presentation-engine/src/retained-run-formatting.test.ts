import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedXmlDocument } from './retained-xml-document.js';
import { readRetainedRunFormatting } from './retained-run-formatting.js';
import { readRunFormatting } from './text-runs.js';
import { parseXmlPart } from './xml.js';
import { literal } from './retained-values.js';
import { streamJson } from './retained-output.js';
const ns = 'http://schemas.openxmlformats.org/drawingml/2006/main';
async function collected(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const chunk of source) { await Promise.resolve(); chunks.push(Buffer.from(chunk)); } return Buffer.concat(chunks).toString(); }
const cases = [
  '', '<rPr/>', '<rPr/><rPr/>', '<rPr sz=" " b="true" i="0" baseline="-0" spc="0x10"/>',
  '<rPr sz=""/>', '<rPr sz="Infinity"/>', '<rPr sz="1e+"/>', '<rPr sz=".5" spc="+12."/>',
  '<rPr sz="1e-999999"/>', '<rPr sz="9007199254740993"/>', '<rPr b="on"/>',
  '<rPr><rtl/></rPr>', '<rPr><rtl val="on"/></rPr>', '<rPr><rtl val="true"/><rtl val="bad"/></rPr>',
  '<rPr><cs charset=" -000128 " panose=" 001122aabbccddeeff00 "/></rPr>',
  '<rPr b="bad"><cs charset="128"/><rtl val="bad"/></rPr>',
  '<rPr><cs charset="1.0"/></rPr>', '<rPr><cs pitchFamily="999"/></rPr>', '<rPr><cs panose="00"/></rPr>',
  '<rPr><solidFill><srgbClr val="anything"><lumOff val="12.5%"/><lumMod val="100000"/></srgbClr></solidFill></rPr>',
  '<rPr><solidFill><schemeClr val="accent1"><lumMod val="-00050000"/></schemeClr></solidFill></rPr>',
  '<rPr><solidFill><srgbClr/><schemeClr/></solidFill></rPr>',
  ...['', ' ', '1.1', '1e2', '1e2%', '1 %', '1% ', '1.5%', '.5%', '+.5%', '9007199254740992', '9007199254740993%', 'NaN', '\u00a01'].map(value => `<rPr><highlight><srgbClr><lumOff val="${value}"/></srgbClr></highlight></rPr>`),
  '<rPr><highlight><srgbClr><lumOff/></srgbClr></highlight></rPr>',
  '<rPr><highlight><srgbClr><lumOff val="0"/><lumOff val="1"/></srgbClr></highlight></rPr>',
  ...['noStrike', 'sngStrike', 'dblStrike', 'other', 'toString', '__proto__'].map(value => `<rPr strike="${value}"/>`),
  `<rPr lang="${'x'.repeat(20000)}" sz="${'0'.repeat(20000)}12"><latin typeface="${'😀'.repeat(10000)}"/><cs charset="${'0'.repeat(20000)}1"/></rPr>`
];
for (const namespace of [ns, 'http://purl.oclc.org/ooxml/drawingml/main']) for (const [index, body] of cases.entries()) it(`preserves run formatting and failure order ${namespace === ns ? 'transitional' : 'strict'} ${index}`, async () => {
  const source = `<r xmlns="${namespace}">${body}</r>`, fs = createMemoryFileSystem();
  fs.readFile = async () => { throw new Error('whole-file read forbidden'); };
  const document = await openRetainedXmlDocument(literal(source), { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  try {
    let expected: unknown, error: unknown;
    try { expected = JSON.parse(JSON.stringify(readRunFormatting(parseXmlPart(new TextEncoder().encode(source)).root))); } catch (failure) { error = failure; }
    if (error) await expect(readRetainedRunFormatting(document, document.root)).rejects.toMatchObject({ message: (error as Error).message });
    else expect(JSON.parse(await collected(streamJson(await readRetainedRunFormatting(document, document.root))))).toEqual(expected);
  } finally { await document.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});
