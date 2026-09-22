import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, createMemoryFileSystem } from '../../src/index.js';
import { pdftotext, pdftotextCommands } from '../../src/commands/pdftotext/index.js';

// Original uncompressed PDF, checked offsets; independent of the command code.
function originalPdf(): Uint8Array {
  const content = 'BT /F1 12 Tf 20 100 Td (Hello world) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 216 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

test('original PDF and negative inputs expose unavailable extraction equally through CLI and SDK', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands()).use(pdftotextCommands());
  t.after(() => shell.dispose());
  const pdf = originalPdf();
  await fs.writeFile('/original.pdf', pdf);
  await fs.writeFile('/empty.pdf', new Uint8Array());
  await fs.writeFile('/malformed.pdf', new TextEncoder().encode('%PDF-1.4\nnot a document'));
  shell.register({ name: 'sdkpdf', execute: context => pdftotext(context, { input: context.args[0]!, output: '-' }) });
  for (const input of ['/original.pdf', '/empty.pdf', '/malformed.pdf', '/missing.pdf']) {
    const cli = await shell.exec(`pdftotext ${input} -`);
    assert.deepEqual(await shell.exec(`sdkpdf ${input}`), cli);
    assert.equal(cli.exitCode, 99);
    assert.equal(cli.stdout, '');
    assert.equal(cli.stderr, 'pdftotext: Qualified PDF font/text/layout engine is unavailable\n');
  }
  for (const flags of ['-f 1 -l 1', '-f 2 -l 1', '-layout', '-raw', '-bbox', '-bbox-layout', '-tsv', '-upw wrong']) {
    const result = await shell.exec(`pdftotext ${flags} /original.pdf -`);
    assert.equal(result.exitCode, 99);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /engine is unavailable/);
  }
  assert.deepEqual(await fs.readFile('/original.pdf'), pdf);
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['empty.pdf', 'malformed.pdf', 'original.pdf']);
});

test('rg and wc pipeline success cannot qualify an unavailable producer', async t => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands()).use(pdftotextCommands());
  t.after(() => shell.dispose());
  for (const pipefail of [false, true]) {
    const result = await shell.exec(`set ${pipefail ? '-o' : '+o'} pipefail; pdftotext /missing.pdf - | wc -c`);
    assert.equal(result.exitCode, pipefail ? 99 : 0);
    assert.equal(result.stdout.trim(), '0');
    assert.match(result.stderr, /engine is unavailable/);
  }
  const search = await shell.exec('set -o pipefail; pdftotext /missing.pdf - | rg Hello');
  assert.notEqual(search.exitCode, 0);
  assert.equal(search.stdout, '');
  assert.match(search.stderr, /engine is unavailable/);
});
