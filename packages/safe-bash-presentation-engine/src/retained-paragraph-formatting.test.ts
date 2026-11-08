import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedXmlDocument } from './retained-xml-document.js';
import { readRetainedParagraphFormatting } from './retained-paragraph-formatting.js';
import { readParagraphFormatting } from './text-paragraphs.js';
import { parseXmlPart } from './xml.js';
import { literal } from './retained-values.js';
import { streamJson } from './retained-output.js';
async function collected(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const chunk of source) { await Promise.resolve(); chunks.push(Buffer.from(chunk)); } return Buffer.concat(chunks).toString(); }
const cases = [
  '', '<pPr/>', '<pPr/><pPr/>', '<pPr marL="12700" marR="-0" indent="0x10" defTabSz="+1e2" lvl=".5" rtl="true" algn="ctr"/>',
  '<pPr marL=""/>', '<pPr marL=" "/>', '<pPr rtl="on"/>', '<pPr algn="unknown"/>',
  '<pPr><buNone/><buChar char="ignored"/></pPr>', '<pPr><buChar char="😀"/></pPr>', '<pPr><buBlip/></pPr>',
  ...['', ' ', '0x10', '1e3', 'Infinity', 'invalid'].map(value => `<pPr><buAutoNum type="unknown" startAt="${value}"/></pPr>`),
  ...['', ' ', '1.5%', ' 1.5%', '1.5% ', '1 %', '1e2%', '0x10%', '.5', '1.', 'NaN', '-0', '9007199254740993'].map(value => `<pPr><lnSpc><spcPct val="${value}"/></lnSpc></pPr>`),
  '<pPr><spcBef><spcPct val="100000"/></spcBef><spcAft><spcPts val="100"/></spcAft></pPr>',
  '<pPr><lnSpc><spcPts/><spcPct val="bad"/></lnSpc></pPr>',
  '<pPr rtl="bad"><spcBef><spcPts val="bad"/></spcBef></pPr>',
  '<pPr><tabLst/></pPr>', '<pPr><tabLst><tab/><tab pos="12700" algn="ctr"/><tab pos="-0" algn="other"/></tabLst></pPr>',
  ...['toString', '__proto__', '', 'l', 'dec'].map(value => `<pPr><tabLst><tab pos="1" algn="${value}"/></tabLst></pPr>`),
  `<pPr marL="${'0'.repeat(20000)}12700" algn="${'x'.repeat(20000)}"><buChar char="${'😀'.repeat(10000)}"/><tabLst>${'<tab pos="12700" algn="r"/>'.repeat(1000)}</tabLst></pPr>`
];
for (const namespace of ['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main']) for (const [index, body] of cases.entries()) it(`preserves paragraph formatting ${namespace} ${index}`, async () => {
  const source = `<p xmlns="${namespace}">${body}</p>`, fs = createMemoryFileSystem(); fs.readFile = async () => { throw new Error('whole-file read forbidden'); };
  const document = await openRetainedXmlDocument(literal(source), { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  try {
    let expected: unknown, error: unknown;
    try { expected = JSON.parse(JSON.stringify(readParagraphFormatting(parseXmlPart(new TextEncoder().encode(source)).root))); } catch (failure) { error = failure; }
    const actual = async () => JSON.parse(await collected(streamJson(await readRetainedParagraphFormatting(document, document.root))));
    if (error) await expect(actual()).rejects.toMatchObject({ message: (error as Error).message }); else expect(await actual()).toEqual(expected);
  } finally { await document.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});
