import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSofficeArguments, createSofficeBudget, parseCsvExportOptions as csvOptions, resolveExportFilter as exportFilter, admitConversion, sofficeCapabilities, SofficeError, type OfficeFilter, type DocumentService, type ConversionParameters } from './index.js';

const limits = { argumentBytes: 4096, files: 20, inputBytes: 4096, retainedBytes: 4096, outputBytes: 4096, nodes: 100, pages: 10, work: 10000 };
function parse(args: string[]) {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try { return parseSofficeArguments(args, budget); } finally { budget.close(); }
}
function parseCsvExportOptions(options: string | undefined) {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try { return csvOptions(options, budget); } finally { budget.close(); }
}
function resolveExportFilter(filters: readonly OfficeFilter[], service: DocumentService, parameters: ConversionParameters) {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try { return exportFilter(filters, service, parameters, budget); } finally { budget.close(); }
}
function code(expected: string) { return (error: unknown) => error instanceof SofficeError && error.code === expected; }

test('files retain event ownership but conversion parameters are global and overwritten', () => {
  const result = parse(['first.docx', '--convert-to', 'pdf:writer_pdf_Export:{"a":"b:c"}', 'second.docx', '--convert-to', 'txt:Text', 'third.docx']);
  assert.deepEqual(result.files, [{ path: 'first.docx', event: 'open' }, { path: 'second.docx', event: 'conversion' }, { path: 'third.docx', event: 'conversion' }]);
  assert.deepEqual(result.conversion, { extension: 'txt', filter: 'Text', options: '' });
  assert.equal(result.headless, true);
});
test('outdir follows current event even through neutral flags', () => {
  assert.throws(() => parse(['--outdir', 'out', '--convert-to', 'pdf']), code('invalid-argument'));
  assert.equal(parse(['--convert-to', 'pdf', '--nologo', '--outdir', 'out']).outdir, 'out');
  assert.throws(() => parse(['--convert-to', 'pdf', '-o', '--outdir', 'out']), code('invalid-argument'));
});
test('deprecated long spelling warns; genuine short spellings do not', () => {
  const result = parse(['-headless', '-convert-to', 'pdf', '-h', '-?', '-n', 'new.docx']);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.help, true);
  assert.equal(result.files[0]?.event, 'new');
});
test('first colon splits import descriptor and second splits export options', () => {
  const result = parse(['--infilter=Text:UTF8:rest', '--convert-to', 'pdf:writer_pdf_Export:{"x":"a:b"}']);
  assert.deepEqual(result.importFilters[0], { name: 'Text', options: 'UTF8:rest' });
  assert.equal(result.conversion?.options, '{"x":"a:b"}');
});
test('cat and script-cat select conversion events with separate global inert targets', () => {
  const result = parse(['--cat', 'a.docx', '--script-cat', 'b.docm']);
  assert.deepEqual(result.conversion, { extension: 'txt', filter: 'Text', options: '' });
  assert.deepEqual(result.files.map(file => file.event), ['conversion', 'conversion']);
  assert.equal(result.textCat, true);
  assert.equal(result.scriptCat, true);
  assert.equal(parse(['--script-cat', '--outdir', 'out']).headless, true);
  assert.equal(parse(['--cat', '--outdir', 'out']).outdir, 'out');
  assert.equal(result.headless, true);
});
test('host capabilities and malformed operands are explicitly rejected', () => {
  for (const args of [['--accept=socket,host=localhost'], ['-env:UserInstallation=file:///tmp/profile'], ['--print-to-file'], ['-p', 'a.docx'], ['--convert-to'], ['--convert-to', '../pdf'], ['--unknown']]) {
    assert.throws(() => parse(args), error => error instanceof SofficeError);
  }
});
test('budget exhaustion, cancellation and cleanup are explicit', () => {
  const controller = new AbortController();
  const budget = createSofficeBudget({ ...limits, files: 1 }, controller.signal);
  assert.throws(() => parseSofficeArguments(['a', 'b'], budget), code('limit'));
  assert.equal(budget.used('files'), 1);
  controller.abort();
  assert.throws(() => budget.checkpoint(), code('cancelled'));
  budget.close();
  assert.equal(budget.used('files'), 0);
  assert.throws(() => budget.charge('work', 1), code('closed'));
});
test('empty invocations still reject cancellation and closed ownership', () => {
  const controller = new AbortController();
  const budget = createSofficeBudget(limits, controller.signal);
  try {
    assert.deepEqual(parseSofficeArguments([], budget).files, []);
    controller.abort();
    assert.throws(() => parseSofficeArguments([], budget), code('cancelled'));
  } finally { budget.close(); }
  assert.throws(() => parseSofficeArguments([], budget), code('closed'));
});
test('CSV absent, incomplete, legacy and modern options are distinct', () => {
  assert.equal(parseCsvExportOptions(undefined).saveAsShown, false);
  assert.equal(parseCsvExportOptions('44,34').complete, false);
  const legacy = parseCsvExportOptions('44,34,UTF8,0');
  assert.equal(legacy.saveAsShown, false);
  assert.equal(legacy.quoteAllText, true);
  const modern = parseCsvExportOptions('44,34,UTF8,1,,0,true,TRUE,false,true,false,-1,,true');
  assert.equal(modern.sheet, -1);
  assert.equal(modern.saveNumberAsSuch, false);
  assert.equal(modern.evaluateFormulas, false);
  assert.equal(modern.bom, true);
  assert.equal(parseCsvExportOptions('44,34,UTF8,1,,0,,,,,,bad').sheet, -23);
});
test('filter inference requires matching document service and preferred export type', () => {
  const filters = [
    { name: 'writer_pdf_Export', service: 'writer' as const, extensions: ['pdf'], import: false, export: true, preferred: true, requires: ['pagination' as const] },
    { name: 'impress_pdf_Export', service: 'presentation' as const, extensions: ['pdf'], import: false, export: true, preferred: true, requires: ['pagination' as const] }
  ];
  assert.equal(resolveExportFilter(filters, 'writer', { extension: 'pdf', filter: '', options: '' }).name, 'writer_pdf_Export');
  assert.throws(() => resolveExportFilter(filters, 'spreadsheet', { extension: 'pdf', filter: '', options: '' }), code('unsupported'));
  assert.throws(() => resolveExportFilter(filters, 'writer', { extension: 'pdf', filter: 'impress_pdf_Export', options: '' }), code('unsupported'));
});
test('conversion does not claim existing engine or layout qualification', () => {
  for (const feature of ['pagination', 'shaping', 'odf', 'spreadsheetFormulas', 'slideMasters', 'charts'] as const) {
    assert.equal(sofficeCapabilities[feature], false);
    assert.throws(() => admitConversion({ name: feature, service: 'writer', extensions: ['pdf'], import: false, export: true, preferred: true, requires: [feature] }), code('unsupported'));
  }
});
test('supplied incomplete CSV defaults differ from absent options and fixed-width is case insensitive', () => {
  const incomplete = parseCsvExportOptions('44,34');
  assert.equal(incomplete.fieldSeparator, '');
  assert.equal(incomplete.textSeparator, '');
  assert.equal(incomplete.encoding, 'unknown');
  assert.equal(parseCsvExportOptions('fix,34,UTF8').fixedWidth, true);
});
test('CSV retained separator tokens do not silently accept unsupported weighted separators or numeric coercion', () => {
  assert.throws(() => parseCsvExportOptions('44/9,34,UTF8'), code('unsupported'));
  assert.throws(() => parseCsvExportOptions('44,34,UTF8,bad'), code('invalid-argument'));
});

test('forced import descriptors accumulate in order', () => {
  assert.deepEqual(parse(['--infilter=Text:one', '--infilter=Text:two:three']).importFilters, [{ name: 'Text', options: 'one' }, { name: 'Text', options: 'two:three' }]);
});
test('CSV endianness is a distinct bounded enum with native little-endian default', () => {
  assert.equal(parseCsvExportOptions(undefined).endianness, 'little');
  assert.equal(parseCsvExportOptions(['44', '34', 'UTF8', '1', '', '0', '', '', '', '', '', '', '', 'true', '0'].join(',')).endianness, 'big');
  assert.equal(parseCsvExportOptions(['44', '34', 'UTF8', '1', '', '0', '', '', '', '', '', '', '', 'true', '1'].join(',')).endianness, 'little');
  assert.throws(() => parseCsvExportOptions(['44', '34', 'UTF8', '1', '', '0', '', '', '', '', '', '', '', 'true', '2'].join(',')), code('unsupported'));
});
test('retained reservations roll back explicitly and failed charges are atomic', () => {
  const budget = createSofficeBudget({ ...limits, retainedBytes: 4 }, new AbortController().signal);
  try {
    budget.charge('retainedBytes', 3);
    assert.throws(() => budget.charge('retainedBytes', 2), code('limit'));
    assert.equal(budget.used('retainedBytes'), 3);
    budget.releaseRetainedBytes(3);
    assert.equal(budget.used('retainedBytes'), 0);
    assert.throws(() => budget.releaseRetainedBytes(1), code('limit'));
    assert.throws(() => budget.charge('work', 0.5), code('limit'));
    assert.throws(() => createSofficeBudget({ ...limits, pages: Infinity }, new AbortController().signal), code('limit'));
  } finally { budget.close(); }
});
test('parser accounts Unicode bytes and rejects ambiguous Unicode argv', () => {
  const budget = createSofficeBudget({ ...limits, argumentBytes: 3 }, new AbortController().signal);
  try { assert.throws(() => parseSofficeArguments(['🙂'], budget), code('limit')); } finally { budget.close(); }
  for (const arg of ['a\0b', '\ud800']) assert.throws(() => parse([arg]), code('invalid-argument'));
});

test('CSV and filter lookup honor caller cancellation and work limits', () => {
  const controller = new AbortController();
  const budget = createSofficeBudget({ ...limits, work: 0 }, controller.signal);
  try {
    assert.throws(() => csvOptions('44,34,UTF8', budget), code('limit'));
    assert.throws(() => exportFilter([{ name: 'Text', service: 'writer', extensions: ['txt'], import: false, export: true, preferred: true, requires: [] }], 'writer', { extension: 'txt', filter: '', options: '' }, budget), code('limit'));
    controller.abort();
    assert.throws(() => csvOptions(undefined, budget), code('cancelled'));
  } finally { budget.close(); }
});
test('filter lookup accounts extension text before comparing registry entries', () => {
  const budget = createSofficeBudget({ ...limits, work: 20 }, new AbortController().signal);
  try {
    assert.throws(() => exportFilter([
      { name: 'Text', service: 'writer', extensions: ['x'.repeat(100)], import: false, export: true, preferred: true, requires: [] }
    ], 'writer', { extension: 'txt', filter: '', options: '' }, budget), code('limit'));
  } finally { budget.close(); }
});
test('terminator preserves literal option-shaped paths and dash admits stdin', () => {
  assert.deepEqual(parse(['--convert-to', 'txt', '-', '--', '--help']).files,
    [{ path: '-', event: 'conversion' }, { path: '--help', event: 'conversion' }]);
});

test('CSV token allocation is bounded and failed parsing preserves earlier reservations', () => {
  const exhausted = createSofficeBudget({ ...limits, retainedBytes: 0 }, new AbortController().signal);
  try {
    assert.throws(() => csvOptions('44,34,UTF8', exhausted), code('limit'));
    assert.equal(exhausted.used('retainedBytes'), 0);
  } finally { exhausted.close(); }
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try {
    budget.charge('retainedBytes', 7);
    assert.throws(() => csvOptions('44/9,34,UTF8', budget), code('unsupported'));
    assert.equal(budget.used('retainedBytes'), 7);
    assert.equal(csvOptions('44,34,UTF8', budget).encoding, 'UTF8');
    assert.ok(budget.used('retainedBytes') > 7);
  } finally { budget.close(); }
});
