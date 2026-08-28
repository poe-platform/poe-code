import assert from 'node:assert/strict';
import { join } from 'node:path';
import { parseLines, repository } from './prior.mjs';
import { declarationReadProof, assertExactT03 } from './predicate.mjs';
import { diagnosticProof } from './diagnostic-control.mjs';

export async function focusedControls(capture, routes, record) {
  const leaf = parseLines(capture.retained.get('raw/T03-tool.jsonl'));
  const root = parseLines(capture.retained.get('raw/T01-tool.jsonl'));
  const status = JSON.parse(capture.retained.get('raw/042-T03/STATUS.json'));
  const consumer = status.cwd, tools = join(status.environment.DU_ADMISSION_WORK, 'tools');
  const product = join(consumer, 'node_modules/virtual-bash');
  const leafEntry = join(product, routes.roots.du.entrypoint), rootEntry = join(product, routes.roots.root.entrypoint);
  const transitive = join(product, 'dist/contracts/io.d.ts');
  const expected = { exitCode: 2, diagnostics: [{ line: 2, code: 2322, mentions: 'number' }] };
  const outcome = { code: status.exit.code, signal: status.exit.signal, stdout: capture.retained.get('raw/042-T03/stdout.data').toString(), stderr: capture.retained.get('raw/042-T03/stderr.data').toString() };
  let count = 0;
  function control(id, expectedOutcome, target, action, message) {
    let value, error;
    try { value = action(); } catch (caught) { error = caught; }
    const observed = error ? 'rejected' : 'accepted';
    record({ id, expected: expectedOutcome, observed, target, classification: 'focused-predicate-control-not-product-case-rescore', value: value ?? null, error: error ? { code: error.code, message: error.message } : null });
    assert.equal(observed, expectedOutcome, id);
    if (error) { assert.equal(error.code, 'ERR_ASSERTION'); if (message) assert.match(error.message, message); }
    count++;
  }
  const proof = (rows, label = 'T03') => declarationReadProof(rows, label, consumer, tools, routes);
  function mutate(rows, path, change) { const copy = structuredClone(rows), row = copy.find(item => item.kind === 'actual-file-read' && item.path === path); assert.ok(row); change(row); return copy; }
  control('C01', 'accepted', 'authentic prior DU leaf and transitive reads, predicate only', () => proof(leaf));
  control('C02', 'accepted', 'authentic prior root and transitive reads, predicate only', () => proof(root, 'T01'));
  control('C03', 'rejected', 'missing DU leaf', () => proof(leaf.filter(row => row.path !== leafEntry)), /WRONG_DECLARATION_ENTRY:du/u);
  control('C04', 'rejected', 'unrelated root cannot replace required DU leaf', () => proof(mutate(leaf, leafEntry, row => { row.path = rootEntry; row.sha256 = routes.packageFiles['dist/index.d.ts']; })), /WRONG_DECLARATION_ENTRY:du/u);
  control('C05', 'rejected', 'missing required transitive contract declaration', () => proof(leaf.filter(row => row.path !== transitive)), /MISSING_REQUIRED_DECLARATION:dist\/contracts\/io.d.ts/u);
  control('C06', 'rejected', 'changed declaration hash', () => proof(mutate(leaf, transitive, row => { row.sha256 = '0'.repeat(64); })), /DECLARATION_READ_HASH/u);
  control('C07', 'rejected', 'outside consumer source fallback with otherwise bound bytes', () => proof(mutate(leaf, leafEntry, row => { row.path = join(repository, 'src/commands/du/index.ts'); })), /READ_OUTSIDE_DECLARED_CONSUMER_OR_TOOLS/u);
  control('C08', 'rejected', 'source path inside package is not declaration dist', () => proof(mutate(leaf, leafEntry, row => { row.path = join(product, 'src/commands/du/index.ts'); })), /SOURCE_OR_UNDECLARED_PRODUCT_READ/u);
  control('C09', 'rejected', 'wrong package exports metadata hash', () => proof(mutate(leaf, join(product, 'package.json'), row => { row.sha256 = '0'.repeat(64); })), /DECLARATION_READ_HASH:package.json/u);
  control('C10', 'rejected', 'changed frozen consumer payload', () => proof(mutate(leaf, join(consumer, 'consumer.ts'), row => { row.sha256 = '0'.repeat(64); })), /UNCHANGED_CONSUMER_NOT_READ/u);
  for (const [id, label] of [['C11', 'T04'], ['C12', 'T05-positive']]) {
    control(id, 'rejected', `${label} remains root-importing, synthetic payload hash with leaf-only reads`, () => proof(mutate(leaf, join(consumer, 'consumer.ts'), row => { row.sha256 = routes.cases[label].payloadSha256; }), label), /WRONG_DECLARATION_ENTRY:root/u);
  }
  control('C13', 'rejected', 'root required transitive closure cannot be dropped', () => proof(root.filter(row => row.path !== transitive), 'T01'), /MISSING_REQUIRED_DECLARATION/u);
  control('C14', 'accepted', 'exact original TS2322 receipt, predicate control only', () => { diagnosticProof(outcome, expected); assertExactT03(outcome, routes); return { exactReceipt: true, historicalCaseRescored: false }; });
  for (const [id, target, mutateResult] of [
    ['C15', 'wrong compiler status', value => { value.code = 0; }],
    ['C16', 'wrong diagnostic code', value => { value.stdout = value.stdout.replace('TS2322', 'TS2307'); }],
    ['C17', 'wrong diagnostic location', value => { value.stdout = value.stdout.replace('(2,29)', '(2,30)'); }],
    ['C18', 'wrong diagnostic message', value => { value.stdout = value.stdout.replace("Type 'string'", "Type 'boolean'"); }],
    ['C19', 'additional unrelated missing-module diagnostic', value => { value.stdout += "consumer.ts(1,1): error TS2307: Cannot find module 'unrelated'.\n"; }],
    ['C20', 'unexpected compiler stderr', value => { value.stderr = 'unrelated diagnostic\n'; }],
  ]) control(id, 'rejected', target, () => { const value = structuredClone(outcome); mutateResult(value); assertExactT03(value, routes); });
  control('C21', 'rejected', 'unchanged complete diagnostic-set matcher rejects unrelated TS2307', () => diagnosticProof({ ...outcome, stdout: "consumer.ts(2,29): error TS2307: Cannot find module 'number'.\n" }, expected));
  control('C22', 'rejected', 'unchanged complete diagnostic-set matcher rejects extra diagnostic', () => diagnosticProof({ ...outcome, stdout: outcome.stdout + "consumer.ts(1,1): error TS2307: Cannot find module 'unrelated'.\n" }, expected));
  assert.equal(count, 22);
}
