import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const capture = fs.openSync('/tmp/strict-extension-design-wjhsx2/seal.txt', 'wx');
try {
  assert.deepEqual(process.argv.slice(2), ['--seal-data']);
  const own = path.dirname(fileURLToPath(import.meta.url));
  const repo = path.resolve(own, '../../..');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const read = filename => {
    assert.ok(!filename.split(path.sep).includes('AGENTS.md'));
    assert.ok(/\.(?:md|json|ts|txt)$/.test(filename));
    const stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1048576);
    return fs.readFileSync(filename);
  };
  const referenceRoot = 'tests/compatibility/bash-strict-reference-source-20260829';
  const referencePaths = ['REPORT.md', 'FIXTURES-v1.json'].map(name => referenceRoot + '/' + name);
  const referenceCommit = '41d4880614cdb02659f7cdbe1f94cc3564c68d26';
  const result = spawnSync('/usr/bin/git', ['ls-tree', '-r', '-z', referenceCommit, '--', ...referencePaths], { cwd: repo, timeout: 10000, maxBuffer: 1048576 });
  fs.writeSync(capture, JSON.stringify({ role: 'development metadata only', status: result.status, signal: result.signal, stdout: result.stdout.toString(), stderr: result.stderr.toString() }) + '\n');
  assert.equal(result.status, 0); assert.equal(result.signal, null);
  const references = result.stdout.toString().split('\0').filter(Boolean).map(record => {
    const separator = record.indexOf('\t');
    const [mode, type, oid] = record.slice(0, separator).split(' ');
    const name = record.slice(separator + 1);
    assert.equal(type, 'blob'); assert.ok(referencePaths.includes(name));
    const bytes = read(path.join(repo, name)); assert.equal(blob(bytes), oid);
    return { path: name, mode, blob: oid, bytes: bytes.length, sha256: sha(bytes), revision: referenceCommit };
  });
  assert.equal(references.length, 2);
  const fixtures = JSON.parse(read(path.join(repo, referenceRoot, 'FIXTURES-v1.json')));
  assert.equal(fixtures.originals.length, 11); assert.equal(fixtures.overlays.length, 7);
  const inherited = [...fixtures.originals, ...fixtures.overlays].map(row => ({
    ...row, expectedNativeRuntime: null, role: 'UNCHANGED_SOURCE_REFERENCE_PROGRAM_UNRUN',
  }));
  const neighbors = [
    { id: 'E19-plus-tail', program: 'set -u; set +uz; printf "set:%s|flags:%s\\n" "$?" "$-"; printf "%s\\n" "$missing"', question: 'Partial +u mutation survives invalid tail; distinguish command status from final script status.' },
    { id: 'E20-subset-listing', program: 'set -- one two; set -u; set +o; printf "count:%s|first:%s\\n" "$#" "$1"', question: 'Capture exact truthful proposed subset listing and positional preservation; ROOT listing policy required.' },
    { id: 'E21-write-only-chain', program: 'set -u; ((outer=(inner=2))); printf "%s|%s\\n" "$outer" "$inner"', question: 'No fabricated LHS read in nested direct assignments; preserve signed64 publication rules.' },
    { id: 'E22-function-fatal', program: 'set -u; f() { let "missing++"; printf "function-after\\n"; }; f; printf "caller-after\\n"', question: 'Typed fatal control must not become a LET status or a local function return; native final tuple open.' },
    { id: 'E23-source-discard', program: 'set -u; . ./missing-length.sh; printf "caller-after\\n"\nprintf "next:%s\\n" "$?"\n', files: { 'missing-length.sh': 'printf "%s\\n" "${#a[@]}"; printf "source-same\\n"\nprintf "source-next\\n"\n' }, question: 'Root/caller versus sourced reader continuation boundary; explicit HOLD pending policy/native evidence, not guessed golden.' },
  ].map(row => ({ ...row, version: 'EXTENSION_DESIGN_V1', role: 'NEIGHBOR_PROGRAM_POLICY_OR_REFERENCE_OPEN', execution: 'UNRUN', expectedRuntime: null, expectedNativeRuntime: null, invocationProfile: 'GNU53_DEFAULT_ONESHOT_C' }));
  const hosts = [
    { id: 'H24-preabort', program: 'set -u; let "missing++"', protocol: 'Preaborted public caller with exact frozen object reason; no command/diagnostic work. Capture rejection separately from mapped shell status.', variants: ['object-reason'] },
    { id: 'H25-falsy-sink', program: 'set -u; let "missing++"', protocol: 'Original caller stderr rejects a tagged falsy value during strict diagnostic; retain exact thrown value and observe completion/cleanup. Do not use truthiness to detect rejection.', variants: ['undefined', 'null', 'false', 'zero', 'empty-string'] },
    { id: 'H26-read-budget', program: 'set -u; let value', protocol: 'Supply a scalar arithmetic expression exceeding existing maxExpansionBytes through explicit env, with a short argument. Confirm existing read-size admission precedes recursive parse/growth and genuine ShellLimitError escapes unchanged; no new limit API.', variants: ['maxExpansionBytes32-value64bytes'] },
    { id: 'H27-registered-cleanup', program: 'f() { set -u; let "missing++"; }; guard', protocol: 'Public registered command guard registers cooperative cleanup before context.invoke(f). Hold/release cleanup explicitly, observe public settlement; compare successful cleanup with cleanup rejection after a mapped nonzero result. No opaque-provider promise or test-only hook.', variants: ['held-cleanup-fulfills', 'held-cleanup-rejects-object'] },
    { id: 'H28-caller-during-diagnostic', program: 'f() { set -u; let "missing++"; }; guard', protocol: 'Use the same existing registered cooperative cleanup scope with a controlled diagnostic sink; request caller abort only after sink entry, explicitly release owned cleanup and preserve exact caller reason ahead of escaping/cleanup outcomes. Record events, not timing-only absence claims.', variants: ['caller-and-cleanup-rejection'] },
  ].map(row => ({ ...row, version: 'EXTENSION_DESIGN_V1', role: 'PUBLIC_HOST_CONTRACT_PROPOSAL', execution: 'UNRUN', expectedRuntime: null, expectedNativeRuntime: null, invocationProfile: 'PRODUCT_PUBLIC_API_ONLY_NO_NATIVE_EQUIVALENCE' }));
  const cases = [...inherited, ...neighbors, ...hosts];
  assert.equal(cases.length, 28); assert.equal(new Set(cases.map(row => row.id)).size, 28);
  for (const row of cases) { assert.equal(row.execution, 'UNRUN'); assert.equal(row.expectedRuntime, null); }
  const product = JSON.parse(read('/tmp/strict-extension-design-wjhsx2/BINDINGS.json'));
  assert.equal(product.candidate, '74dfe69135a3fc5ba89396b20dd32d9c9daae131');
  assert.equal(product.manifestSha256, '4f196057df98c3aed05519b78eaa725fc9d7eb3c73634613662ac6b927715d32');
  for (const row of product.inputs) assert.equal(sha(read(path.join('/tmp/conditional-author-gq4Ndd/source', row.path))), row.sha256);
  const bindings = { role: 'SOURCE_DATA_ONLY_DESIGN', date: '2026-08-29', product, references, productionWriteSet: [], executions: { product: 0, native: 0, compiler: 0, worker: 0, engine: 0 }, plannedFutureWriteSet: ['src/shell/runtime.ts'], qualification: 'No implementation authority or native binary qualification. Current unit3 provisional; original Unit2 rows remain OPEN.' };
  fs.writeFileSync(path.join(own, 'BINDINGS.json'), JSON.stringify(bindings, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(own, 'CASES.json'), JSON.stringify({ schema: 'strict-extension-design-v1', original: 11, inheritedProbes: 7, newPrograms: 5, hostProtocols: 5, identities: 28, nativeExecutions: 0, cases }, null, 2) + '\n', { flag: 'wx' });
  const raw = [];
  let bytes = 0;
  for (const name of fs.readdirSync('/tmp/strict-extension-design-wjhsx2').sort()) {
    if (name === 'seal.txt') continue;
    const content = read(path.join('/tmp/strict-extension-design-wjhsx2', name));
    bytes += content.length; assert.ok(bytes <= 4 * 1024 * 1024);
    raw.push({ name, bytes: content.length, sha256: sha(content), base64: content.toString('base64') });
  }
  const archive = gzipSync(Buffer.from(JSON.stringify(raw)), { level: 9 });
  const roundtrip = JSON.parse(gunzipSync(archive, { maxOutputLength: 8 * 1024 * 1024 }));
  assert.equal(roundtrip.length, raw.length);
  for (const row of roundtrip) assert.equal(sha(Buffer.from(row.base64, 'base64')), row.sha256);
  fs.writeFileSync(path.join(own, 'SOURCE-DATA.json.gz'), archive, { flag: 'wx' });
  const summary = { role: 'DATA_BINDING_NOT_PRODUCT_TEST', inputs: product.inputs.length, referenceBlobs: references.length, identities: cases.length, executions: 0, rawRecords: raw.length, rawBytes: bytes, archiveBytes: archive.length, archiveSha256: sha(archive), applicableInstructionReads: 'context only, no plaintext instruction snapshots', allInspectedFilesUnchanged: true };
  fs.writeFileSync(path.join(own, 'RECEIPT.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  fs.writeSync(capture, JSON.stringify(summary) + '\n'); console.log(JSON.stringify(summary));
} catch (error) {
  fs.writeSync(capture, String(error?.stack ?? error)); throw error;
} finally { fs.closeSync(capture); }
