import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { PdfDocument } from '../document.js';
import { extractPageFromDisplayList, formatExtractedPageText } from './text.js';
import { PdfRawTextIndex } from './raw-text-index.js';
import { streamLogicalTextChunks } from './logical-text-stream.js';

const bytes = readFileSync(new URL('../fixtures/pdfjs-Type3WordSpacing.pdf', import.meta.url));
const expected = 'ab\nbaba\nabba\nabab\nabbaabba\nba\nabab baba abbaabba\nab\nba\nabba';
it('matches Poppler Type 3 word and line grouping in buffered and retained extraction', async () => {
  const display = PdfDocument.load(bytes).getPage(0).evaluateDisplayList();
  const options = { mode: 'logical' as const };
  expect(formatExtractedPageText(extractPageFromDisplayList(display, options), options)).toBe(expected);
  const fs = createMemoryFileSystem(); await fs.mkdir('/scratch');
  const index = await PdfRawTextIndex.create(display.glyphs, { fs, directory: '/scratch' }, { ...options, pageWidth: 300 });
  try {
    let result = ''; const decoder = new TextDecoder();
    for await (const part of streamLogicalTextChunks(index)) result += decoder.decode(part);
    expect(result).toBe(expected);
  } finally { await index.close(); }
  expect(await fs.readdir('/scratch')).toEqual([]);
});

for (const fixedPitch of [undefined, 8]) it(`preserves variable Type 3 spacing in layout output (pitch=${fixedPitch})`, async () => {
  const display = PdfDocument.load(bytes).getPage(0).evaluateDisplayList();
  const options = { mode: 'layout' as const, fixedPitch };
  const buffered = formatExtractedPageText(extractPageFromDisplayList(display, options), options);
  expect(buffered.split('\n').length).toBeGreaterThan(1);
  expect(new Set(buffered.split('\n').map(line => line.trim())).size).toBeGreaterThan(3);
  expect([...buffered].filter(char => char === 'a' || char === 'b')).toHaveLength(48);
  const fs = createMemoryFileSystem(); await fs.mkdir('/scratch');
  const index = await PdfRawTextIndex.create(display.glyphs, { fs, directory: '/scratch' }, options);
  try {
    let result = '';
    for await (const part of index.layoutText(options)) result += part;
    expect(result).toBe(buffered);
  } finally { await index.close(); }
  expect(await fs.readdir('/scratch')).toEqual([]);
});

it('releases Type 3 storage on limits and cancellation', async () => {
  const glyphs = PdfDocument.load(bytes).getPage(0).evaluateDisplayList().glyphs;
  const fs = createMemoryFileSystem(); await fs.mkdir('/scratch');
  const storage = { fs, directory: '/scratch' };
  await expect(PdfRawTextIndex.create(glyphs, storage, { mode: 'logical', maxStorageBytes: 16384 })).rejects.toMatchObject({ code: 'E_LIMIT' });
  const controller = new AbortController();
  const input = (async function* () { yield* glyphs; controller.abort(); })();
  await expect(PdfRawTextIndex.create(input, storage, { mode: 'logical', signal: controller.signal })).rejects.toThrow();
  expect(await fs.readdir('/scratch')).toEqual([]);
});
