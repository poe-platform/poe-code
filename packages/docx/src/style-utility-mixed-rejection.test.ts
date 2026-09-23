import { expect, it, vi } from 'vitest';
import { Volume } from 'memfs';
import { MemoryFileSystem, Shell } from '@poe-platform/safe-bash';
import { docxCommands } from '@poe-platform/safe-bash/commands/docx';
import * as api from './index.js';
import { textFixture, textContext, w } from '../tests/fixtures/text.js';
import { readPackage } from '../tests/assertions.js';
for (const strict of [false, true]) for (const kind of ['docx', 'dotx'] as const)
for (const route of ['sdk-batch', 'cli-batch'])
it(`rejects contract-defined mixed style utility/model arrays without publication; ${route}; ${kind}; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>', { styles: { kind: 'styles', xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:customStyle="1" w:styleId="Atlas"><w:name w:val="Atlas"/></w:style></w:styles>` } }, strict));
  if (kind === 'dotx') parts.set('[Content_Types].xml', new TextEncoder().encode(new TextDecoder().decode(parts.get('[Content_Types].xml')).replace('document.main+xml', 'template.main+xml')));
  const volume = Volume.fromJSON({ '/input': '', '/out': '' }); await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date('2026-01-02T03:04:06Z') })) }, { async write(b) { volume.appendFileSync('/input', b); } }, { order: 'input', compression: 'store' }, textContext);
  const input = new Uint8Array(volume.readFileSync('/input') as Buffer), batch = { version: 1, operations: [{ operation: 'styles.set', arguments: { name: 'Atlas', bold: true } }, { operation: 'model.document.Document.styles.get', receiver: { resultHandle: 'document' }, arguments: {} }] }, write = vi.fn(async (b: Uint8Array) => { volume.appendFileSync('/out', b); });
  if (route === 'sdk-batch') { await expect(api.executeDocumentBatch(input, batch, { output: '-' }, { ...textContext, stdout: { write }, encoding: { order: 'input', compression: 'store' } })).rejects.toMatchObject({ code: 'unsupported-profile' }); expect(write).not.toHaveBeenCalled(); }
  else { const fs = new MemoryFileSystem(); await fs.writeFile('/input', input); await fs.writeFile('/out', new TextEncoder().encode('Original destination')); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --output /out --force --json`); expect(r.exitCode, r.stdout + r.stderr).toBe(1); expect(JSON.parse(r.stdout).errors[0].code).toBe('unsupported-profile'); expect(new TextDecoder().decode(await fs.readFile('/out'))).toBe('Original destination'); expect(await fs.readFile('/input')).toEqual(input); } finally { await shell.dispose(); } }
  expect(volume.readFileSync('/out').length).toBe(0); expect(new Uint8Array(volume.readFileSync('/input') as Buffer)).toEqual(input);
});
