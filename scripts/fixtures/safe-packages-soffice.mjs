import assert from 'node:assert/strict';
import { createSofficeBudget, parseSofficeArguments, parseSofficeByteArguments, parseCsvExportOptions, admitConversion, SofficeError, sofficeCapabilities } from '@poe-platform/safe-bash/commands/soffice';
const budget = createSofficeBudget({ argumentBytes: 4096, files: 10, inputBytes: 4096, retainedBytes: 4096, outputBytes: 4096, nodes: 100, pages: 10, work: 10000 }, new AbortController().signal);
try {
  const request = parseSofficeArguments(['open.docx', '--convert-to', 'pdf', '--nologo', '--outdir', '/out', 'convert.docx'], budget);
  assert.deepEqual(request.files.map(file => file.event), ['open', 'conversion']);
  assert.equal(request.outdir, '/out');
  const args = ['\ufeffrésumé.docx', '--convert-to', 'pdf', '🙂.docx'];
  assert.deepEqual(parseSofficeByteArguments(args.map(arg => new TextEncoder().encode(arg)), budget), parseSofficeArguments(args, budget));
  assert.throws(() => parseSofficeByteArguments([new Uint8Array([0xff])], budget), error => error instanceof SofficeError && error.code === 'invalid-argument');
  assert.equal(parseCsvExportOptions('44,34,UTF8,1,,0,,,,,,-1', budget).sheet, -1);
  assert.equal(sofficeCapabilities.pagination, false);
  assert.throws(() => admitConversion({ name: 'writer_pdf_Export', service: 'writer', extensions: ['pdf'], import: false, export: true, preferred: true, requires: ['pagination'] }), error => error instanceof SofficeError && error.code === 'unsupported');
} finally { budget.close(); }
assert.throws(() => budget.checkpoint(), error => error instanceof SofficeError && error.code === 'closed');
console.log('Isolated installed soffice parsing, errors and capability gates passed');

const root = await import('@poe-platform/safe-bash');
const contracts = await import('@poe-platform/safe-bash/contracts');
const { sofficeCommands, createSofficeCommand, soffice } = await import('@poe-platform/safe-bash/commands/soffice');
assert.equal(createSofficeCommand().runtimeIdentity, contracts.commandRuntimeIdentity);
const fs = root.createMemoryFileSystem(), shell = new root.Shell({ fs });
try {
  assert.equal((await shell.exec('soffice --help')).exitCode, 127);
  shell.use(sofficeCommands());
  const help = await shell.exec('soffice --help');
  assert.equal(help.exitCode, 0); assert.match(help.stdout, /conversion.*not qualified/);
  shell.use({ name: 'soffice-sdk-witness', setup(host) {
    host.commands.register({ name: 'sdk-soffice-help', runtimeIdentity: contracts.commandRuntimeIdentity,
      execute(context) { return soffice(context, { args: ['-h'] }); } });
    host.commands.register({ name: 'sdk-soffice', runtimeIdentity: contracts.commandRuntimeIdentity,
      execute(context) { return soffice(context, { conversion: { extension: 'pdf', filter: '', options: '' }, files: ['--literal.docx'] }); } });
    host.commands.register({ name: 'raw-soffice', runtimeIdentity: contracts.commandRuntimeIdentity,
      execute(context) { const carrier = contracts.createCommandArguments([]).withValues([Uint8Array.of(255)]);
        return createSofficeCommand().execute({ ...context, args: carrier.args, argumentValues: carrier }); } });
  } });
  const cli = await shell.exec('soffice --convert-to pdf -- --literal.docx');
  assert.equal(cli.exitCode, 1); assert.equal(cli.stdout, '');
  assert.deepEqual(await shell.exec('sdk-soffice'), cli);
  assert.deepEqual(await shell.exec('sdk-soffice-help'), help);
  const raw = await shell.exec('raw-soffice');
  assert.equal(raw.exitCode, 1); assert.match(raw.stderr, /invalid UTF-8 argument/);
  assert.deepEqual(await fs.readdir('/'), []);
} finally { await shell.dispose(); }
console.log('Installed soffice command/SDK, shared byte ownership and opt-in registration passed');
