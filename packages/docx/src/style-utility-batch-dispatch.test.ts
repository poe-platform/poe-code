import { expect, it } from 'vitest';
import { Volume } from 'memfs';
import { MemoryFileSystem, Shell } from 'virtual-bash';
import { docxCommands } from 'virtual-bash/commands/docx';
import * as api from './index.js';
import { textFixture, textContext, w } from '../tests/fixtures/text.js';
import { readPackage, assertPackageLinks } from '../tests/assertions.js';
const cases = [
  ['styles.list', {}], ['styles.get', { name: 'Atlas' }], ['styles.defaults.get', {}],
  ['styles.latent.list', {}], ['styles.latent.get', { name: 'Ghost' }], ['styles.latent.defaults.get', {}],
  ['styles.add', { name: 'New', type: 'character', bold: true }],
  ['styles.set', { name: 'Atlas', bold: false, font: '日本 Serif' }],
  ['styles.defaults.set', { italic: true }], ['styles.latent.add', { name: 'New Ghost', hidden: true }],
  ['styles.latent.set', { name: 'Ghost', hidden: false }], ['styles.latent.remove', { name: 'Ghost' }],
  ['styles.latent.defaults.set', { defaultToHidden: false, defaultPriority: 0 }]
] as const;
for (const strict of [false, true]) for (const kind of ['docx', 'dotx'] as const)
for (const [operation, args] of cases) for (const route of ['sdk-batch', 'cli-batch'])
it(`executes declared utility ${operation} independently; ${route}; ${kind}; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>', { styles: { kind: 'styles', xml: `<w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault></w:docDefaults><w:latentStyles w:defSemiHidden="1" w:count="1"><w:lsdException w:name="Ghost" w:semiHidden="1"/></w:latentStyles><w:style w:type="paragraph" w:customStyle="1" w:styleId="Atlas"><w:name w:val="Atlas"/><w:rPr><w:b/></w:rPr></w:style><!--retain--><?policy keep?></w:styles>` } }, strict));
  if (kind === 'dotx') parts.set('[Content_Types].xml', new TextEncoder().encode(new TextDecoder().decode(parts.get('[Content_Types].xml')).replace('document.main+xml', 'template.main+xml')));
  const volume = Volume.fromJSON({ '/input': '', '/out': '' });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date('2026-01-02T03:04:06Z') })) }, { async write(b) { volume.appendFileSync('/input', b); } }, { order: 'input', compression: 'store' }, textContext);
  const input = new Uint8Array(volume.readFileSync('/input') as Buffer), batch = { version: 1, operations: [{ id: 'utility', operation, arguments: args }] }, read = ['list', 'get'].includes(operation.split('.').at(-1)!), pub = { ...textContext, stdout: { async write(b: Uint8Array) { volume.appendFileSync('/out', b); } }, encoding: { order: 'input', compression: 'store' } as const };
  if (operation === 'styles.add') batch.operations.unshift({ id: 'format', operation: 'styles.set', arguments: { name: 'Atlas', bold: false } } as typeof batch.operations[number], { id: 'text', operation: 'text.replace', arguments: { find: 'Retain', with: 'Changed', all: true } } as unknown as typeof batch.operations[number]);
  let data: unknown;
  if (route === 'sdk-batch') { const r = await api.executeDocumentBatch(input, batch, read ? {} : { output: '-' }, pub); expect(r.results.at(-1)!.id).toBe('utility'); data = r.results.at(-1)!.data; }
  else { const fs = new MemoryFileSystem(); await fs.writeFile('/input', input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' ${read ? '' : '--output /out'} --json`); expect(r.exitCode, r.stdout + r.stderr).toBe(0); data = JSON.parse(r.stdout).data.results.at(-1).data; if (!read) volume.writeFileSync('/out', await fs.readFile('/out')); expect(await fs.readFile('/input')).toEqual(input); } finally { await shell.dispose(); }
  }
  if (read) { const expected = await api.inspectDocumentStyles(input, { ...(Object.hasOwn(args, 'name') ? { name: (args as { name: string }).name } : {}), ...(operation.includes('.latent.') ? { latent: true } : {}) }, textContext); expect(data).toEqual(expected); expect(volume.readFileSync('/out').length).toBe(0); }
  else { const output = new Uint8Array(volume.readFileSync('/out') as Buffer), saved = readPackage(output); assertPackageLinks(saved); for (const [name, bytes] of parts) if (name !== 'word/styles.xml' && !(operation === 'styles.add' && name === 'word/document.xml')) expect(saved.get(name), name).toEqual(bytes); const report = await api.inspectDocumentStyles(output, {}, textContext);
    if (operation === 'styles.add') { expect(report.styles.find(s => s.name === 'New')?.direct.bold).toBe(true); expect(report.styles.find(s => s.name === 'Atlas')?.direct.bold).toBe(false); expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe('Changed 日本 עברית é 🌊'); }
    if (operation === 'styles.set') expect(report.styles.find(s => s.name === 'Atlas')?.direct).toMatchObject({ bold: false, font: '日本 Serif' });
    if (operation === 'styles.defaults.set') expect(report.defaults.run.italic).toBe(true);
    const latent = await api.inspectDocumentStyles(output, { latent: true }, textContext); expect(latent.latent).not.toBeNull();
    expect(new TextDecoder().decode(saved.get('word/styles.xml'))).toContain('<!--retain--><?policy keep?>');
  }
  expect(new Uint8Array(volume.readFileSync('/input') as Buffer)).toEqual(input);
});
