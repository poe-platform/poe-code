import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { hash, inventory, read, save, supervised } from './common.mjs';

const own = dirname(fileURLToPath(import.meta.url)), capture = join(own, process.argv[2] ?? 'run05'), state = read(join(capture, 'state.json'));
const output = join(capture, 'legacy-ast-v2'); assert(!existsSync(output)); mkdirSync(output);
const compressed = Buffer.from(execFileSync('git', ['--no-replace-objects', 'show', state.previous + ':tests/commands/html-to-markdown-independent-20260827/EVIDENCE.json.gz.base64'], { cwd: resolve(own, '../../../..'), maxBuffer: 64 * 1024 * 1024 }).toString(), 'base64');
const metadata = read(join(state.legacy, 'EVIDENCE.json')); assert.equal(hash(compressed), metadata.archiveSha256);
const archive = JSON.parse(gunzipSync(compressed));
assert.deepEqual(Object.keys(archive).sort(), metadata.files.map(row => row.path).sort());
for (const file of metadata.files) { const bytes = Buffer.from(archive[file.path], 'base64'); assert.equal(hash(bytes), file.sha256); assert.equal(bytes.length, file.bytes); }
const comparative = Buffer.from(archive['capture-01/author-pandoc.json'], 'base64');
cpSync(join(state.legacy, 'semantic-audit.mjs'), join(output, 'semantic-audit.mjs'));
save(join(output, 'PRE-RUN.json'), { at: new Date().toISOString(), historicalArchive: metadata.archiveSha256, historicalFiles: metadata.files.length, supervisor: hash(readFileSync(join(own, 'common.mjs'))), driver: hash(readFileSync(new URL(import.meta.url))), unchangedAudit: hash(readFileSync(join(output, 'semantic-audit.mjs'))), previousComparative: hash(comparative), sourceResults: hash(readFileSync(join(capture, 'RESULTS.json'))) });
const sourceResults = read(join(capture, 'RESULTS.json')), rows = [], results = [];
for (const layout of ['isolated', 'moved']) {
  const destination = join(output, layout); mkdirSync(join(destination, 'comparative'), { recursive: true });
  writeFileSync(join(destination, 'author-pandoc.json'), comparative);
  for (const id of ['R01-ordered-period-text', 'R02-ordered-paren-text', 'R03-strike-text', 'R06-adjacent-emphasis', 'title-alt', 'L18-malformed-tail']) {
    const sourceId = id === 'title-alt' ? 'U-title-alt-injection-v2' : id;
    const result = sourceResults.rows.find(row => row.layout === layout && row.id === sourceId); assert(result?.result?.actual?.stdout);
    const input = result.result.actual.stdout;
    const row = await supervised(join(destination, 'parser'), id, state.pandoc, ['--sandbox', '--from=' + (id === 'L18-malformed-tail' ? 'commonmark+strikeout' : 'commonmark_x'), '--to=json'], { cwd: destination, env: { PATH: dirname(process.execPath) }, input, inputs: { upstreamReceipt: hash(Buffer.from(JSON.stringify(result))), inputSHA256: hash(input) }, driver: hash(readFileSync(new URL(import.meta.url))) });
    assert.equal(row.outcome, 'PASS'); rows.push({ layout, ...row }); cpSync(join(destination, 'parser', id + '.stdout'), join(destination, 'comparative', 'parse-' + id + '.stdout'));
  }
  const audit = await supervised(join(destination, 'audit'), 'unchanged-five', process.execPath, [join(output, 'semantic-audit.mjs'), layout], { cwd: output, env: { PATH: dirname(process.execPath) }, inputs: inventory(output), driver: hash(readFileSync(new URL(import.meta.url))) });
  assert.equal(audit.outcome, 'PASS'); rows.push({ layout, ...audit });
  results.push({ layout, originalFive: read(join(destination, 'semantic-assertions.json')) });
  const extract = tree => {
    let text = '';
    const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; if (node.t === 'Str') text += node.c; else if (node.t === 'Space') text += ' '; else Object.values(node).forEach(visit); };
    visit(tree.blocks); return text;
  };
  const malformed = extract(read(join(destination, 'comparative/parse-L18-malformed-tail.stdout')));
  const title = extract(read(join(destination, 'comparative/parse-title-alt.stdout')));
  assert.equal(malformed, 'before <a href="unfinished');
  assert.equal(title, 'safe] [evil](javascript:bad) <img src=x onerror=evil>');
  results.at(-1).additionalVisibleChecks = { malformed, title, outcome: 'PASS', meaning: 'Semantic observations only; original exact-byte failures remain failures without an expectation waiver.' };
}
save(join(output, 'RESULTS.json'), { rows, results, previousArchiveAuthenticated: metadata.files.length });
console.log(JSON.stringify({ subprocesses: rows.length, oldAST: results.map(row => [row.layout, row.originalFive.rows.map(test => test.outcome)]) }));
