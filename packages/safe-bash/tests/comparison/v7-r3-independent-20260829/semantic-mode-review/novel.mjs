import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCoordinator } from '../../breadth-continuation-20260828/executor-v7-r3/runs/semantic-mode-v1-20260829/body.mjs';
import { bindSemanticGrant } from '../../breadth-continuation-20260828/executor-v7-r3/runs/semantic-mode-v1-20260829/profile.mjs';
import { assessSemanticTerminal, supervisorData } from '../../breadth-continuation-20260828/executor-v7-r3/runs/semantic-mode-v1-20260829/semantic-assessor.mjs';
import { loadAuthorityReference } from '../../breadth-continuation-20260828/executor-v7-r3/runs/semantic-mode-v1-20260829/authorization.mjs';
import { supervise } from '../../breadth-continuation-20260828/executor-v7-r3/supervisor.mjs';
import { compose, changedTerminal, references } from './generated/fixtures.mjs';
const home = path.dirname(fileURLToPath(import.meta.url));
export async function run(author) {
  const rows = [];
  const test = async (id, body) => { try { rows.push({ id, pass: true, detail: await body() ?? null }); } catch (error) { rows.push({ id, pass: false, code: error.code ?? null, message: String(error.message).slice(0, 2000) }); } };
  const positive = author.positive;
  assert(positive && author.ordinary, 'AUTHOR_COMPOSED_PREREQUISITES');
  await test('N01-wrong-mode-no-dispatch', async () => {
    let calls = 0;
    const result = await runCoordinator({ root: path.join(home, 'work'), repository: home, mode: 'admission', runId: 'independent-wrong-mode' }, { checkpoint: async () => {}, cleanup: async () => {}, inheritedExitCode: () => 0, writeStream: () => {}, configure() { calls++; throw Error('UNEXPECTED'); } });
    assert.equal(calls, 0); assert.equal(result.ledger.length, 0); assert.equal(result.publication.exitCode, 1); assert.equal(result.output.fatal.code, 'ARGUMENTS');
  });
  await test('N02-admission-grant-not-mutated', () => {
    const input = { ...author.grant, phase: 'admission' }; const before = JSON.stringify(input);
    assert.throws(() => bindSemanticGrant(input, author.grant.recipeSha256, author.grant.reviewSha256)); assert.equal(JSON.stringify(input), before);
  });
  await test('N03-missing-operation-before-child', async () => {
    const sentinel = Object.assign(new Error('MISSING_OPERATION'), { code: 'INDEPENDENT_MISSING_OPERATION' });
    const value = await compose('independent-missing-operation', { tweak(drivers) { drivers.selectOperation = () => { throw sentinel; }; } });
    assert.equal(value.result.output.fatal, sentinel); assert.equal(value.result.ledger.length, 0); assert.equal(value.result.output.tail.length, 99); assert.equal(value.result.publication.exitCode, 1);
  });
  await test('N04-duplicate-operation-stops-after-one', async () => {
    const value = await compose('independent-duplicate-operation', { tweak(drivers) { const original = drivers.selectOperation; let first; drivers.selectOperation = (...args) => { const selected = original(...args); return first ??= selected; }; } });
    assert.equal(value.result.output.fatal.code, 'OPERATION_ORDER'); assert.equal(value.result.ledger.length, 1); assert.equal(value.result.ledger[0].reaped, true); assert.equal(value.result.publication.exitCode, 1);
  });
  await test('N05-semantic-call-count-mismatch', () => {
    const bad = changedTerminal(positive.receipt, terminal => { terminal.execCounts.semantic = 98; terminal.execCounts.total = 164; });
    const result = assessSemanticTerminal(bad, positive.root, { syntheticOnly: true }); assert.equal(result.protocolQualified, false); return result.error;
  });
  await test('N06-mismatch-zero-exit-is-not-protocol-pass', () => {
    assert.equal(author.ordinary.assess().protocolQualified, true); assert.equal(author.ordinary.receipt.exit.code, 1);
    const bad = changedTerminal(author.ordinary.receipt, terminal => { terminal.exitCode = 0; }); bad.exit.code = 0; bad.close.code = 0; bad.natural = true;
    const result = assessSemanticTerminal(bad, author.ordinary.root, { syntheticOnly: true }); assert.equal(result.protocolQualified, false); return result.error;
  });
  await test('N07-synthetic-authority-not-production-credit', () => {
    const positiveResult = positive.assess(); assert.equal(positiveResult.caseCounts.unqualified, 1); assert.equal(positiveResult.semanticAllQualified, false);
    const result = assessSemanticTerminal(positive.receipt, positive.root); assert.equal(result.protocolQualified, false); assert.equal(result.error.message, 'SEMANTIC_AUTH_CLASS'); return result.error;
  });
  await test('N08-signal-disposition-not-natural', () => { const bad = structuredClone(positive.receipt); bad.close.signal = 'SIGTERM'; assert.throws(() => supervisorData(bad), /SEMANTIC_DISPOSITION/); });
  await test('N09-composed-evidence-cap-before-worker', async () => {
    const value = await compose('independent-budget', { tweak(drivers) { drivers.evidenceLimit = 1; } });
    assert.equal(value.result.output.unsafe, true); assert.equal(value.result.ledger.length, 0); assert.equal(value.result.publication.exitCode, 1); assert(Object.hasOwn(value.result.output, 'fatal'));
    return { primaryCode: value.result.output.fatal?.code ?? null, helperOneByteLimitNotActual248MiBProof: true };
  });
  await test('N10-authority-getter-never-read', () => {
    let getter = 0, reader = 0; const reference = { ...references.review }; Object.defineProperty(reference, 'path', { enumerable: true, get() { getter++; return 'bad'; } });
    assert.throws(() => loadAuthorityReference(reference, { read() { reader++; }, observe() {}, receipts: [], ordinal: 1, syntheticOnly: true })); assert.equal(getter, 0); assert.equal(reader, 0);
  });
  await test('N11-unretired-authority-observed-then-refused', () => {
    const receipts = [], events = []; let calls = 0;
    assert.throws(() => loadAuthorityReference(references.review, { read() { calls++; return { pid: 880001, status: 0, signal: null, errorCode: null, stdout: Buffer.from('{}'), stderr: Buffer.alloc(0), reaped: false }; }, observe(row) { events.push(row); }, receipts, ordinal: 1, syntheticOnly: true }), /AUTHORITY_METADATA_CHILD/);
    assert.equal(calls, 1); assert.equal(receipts.length, 1); assert.equal(events.length, 1); assert.equal(events[0].receipt.reaped, false);
  });
  await test('N12-owned-stdout-overcap-refuses-counted-tail', async () => {
    const receipt = await supervise('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', ['--unhandled-rejections=strict', path.join(home, 'byte-stub.mjs')], home, { deadline: 5000 });
    fs.writeFileSync(path.join(home, 'work/N12-RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    assert.equal(receipt.reaped, true); assert(receipt.close); assert(receipt.failures.some(row => row.code === 'CAPTURE_LIMIT')); assert.equal(receipt.natural, false);
    assert.equal(receipt.captureBytes.stdout, 65537); assert.equal(Buffer.from(receipt.stdout, 'base64').length, 65536); assert(Buffer.from(receipt.stdout, 'base64').equals(Buffer.alloc(65536, 81))); assert.throws(() => supervisorData(receipt));
    return { observed: receipt.captureBytes.stdout, retained: 65536, unretained: 1, refusal: true, reaped: true, noTailContentsOrUniversalLosslessnessClaim: true };
  });
  return rows;
}
