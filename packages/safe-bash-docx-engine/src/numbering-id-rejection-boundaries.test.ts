import { expect, it } from 'vitest';
import { Volume } from 'memfs';
import { MemoryFileSystem, Shell } from '@poe-platform/safe-bash';
import { docxCommands } from '@poe-platform/safe-bash/commands/docx';
import * as api from './index.js';
import { textFixture, textContext, w } from '../tests/fixtures/text.js';
import { readPackage } from '../tests/assertions.js';
for (const strict of [false, true]) for (const kind of ['docx', 'dotx'] as const)
for (const id of ['-1', '9007199254740992', '1.5', 'NaN', '', '&#xA0;1&#xA0;'])
for (const route of ['model-preserve', 'sdk', 'cli', 'sdk-batch', 'cli-batch'] as const)
it(`rejects invalid numbering ID ${JSON.stringify(id)} without publication; ${route}; ${kind}; strict=${strict}`, async () => {
  const inputParts = readPackage(await textFixture(`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr></w:pPr><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>`, { numbering: { kind: 'numbering', xml: `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="${id}"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num><!--retain--></w:numbering>` } }, strict));
  if (kind === 'dotx') inputParts.set('[Content_Types].xml', new TextEncoder().encode(new TextDecoder().decode(inputParts.get('[Content_Types].xml')).replace('document.main+xml', 'template.main+xml')));
  const volume = Volume.fromJSON({ '/input': '', '/out': '' });
  await api.writeArchive({ comment: new Uint8Array(), members: [...inputParts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date('2026-01-02T03:04:06Z') })) }, { async write(b) { volume.appendFileSync('/input', b); } }, { order: 'input', compression: 'store' }, textContext);
  const input = new Uint8Array(volume.readFileSync('/input') as Buffer), sink = { async write(b: Uint8Array) { volume.appendFileSync('/out', b); } }, pub = { ...textContext, stdout: sink, encoding: { order: 'input', compression: 'store' } as const }, batch = { version: 1, operations: [{ operation: 'lists.set', arguments: { paragraph: 1, restart: true, start: 5 } }] };
  expect((await api.validateDocument(input, textContext)).valid).toBe(false);
  if (route === 'model-preserve') { const d = await api.Document(input, textContext); expect(d.paragraphs[0]!.text).toBe('Retain 日本 עברית é 🌊'); expect(d.part.numbering_part.numbering_definitions.length).toBe(1); await expect(d.save(sink)).rejects.toMatchObject({ code: 'invalid-package' }); }
  else if (route === 'sdk') await expect(api.editDocumentLists(input, { operation: 'lists.set', options: { paragraph: 1, restart: true, start: 5, output: '-' } }, pub)).rejects.toMatchObject({ code: 'invalid-package' });
  else if (route === 'sdk-batch') await expect(api.executeDocumentBatch(input, batch, { output: '-' }, pub)).rejects.toMatchObject({ code: 'invalid-package' });
  else { const fs = new MemoryFileSystem(); await fs.writeFile('/input', input); await fs.writeFile('/out', new TextEncoder().encode('Original destination')); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const r = await shell.exec(route === 'cli' ? 'docx lists set /input --paragraph 1 --restart true --start 5 --output /out --force --json' : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output /out --force --json`); expect(r.exitCode, r.stdout + r.stderr).toBe(1); expect(JSON.parse(r.stdout).errors[0].code).toBe('invalid-package'); expect(new TextDecoder().decode(await fs.readFile('/out'))).toBe('Original destination'); expect(await fs.readFile('/input')).toEqual(input); } finally { await shell.dispose(); }
  }
  expect(volume.readFileSync('/out').length).toBe(0); expect(new Uint8Array(volume.readFileSync('/input') as Buffer)).toEqual(input);
});
