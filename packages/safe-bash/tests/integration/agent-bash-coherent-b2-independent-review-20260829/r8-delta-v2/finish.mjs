import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { identity } from '../../agent-bash-coherent-author-20260829/admin-owner-r1/tracked-owner.mjs';
export async function finish(context) {
  const { owner, read, git, repo, root, relative, raw, author, digest } = context;
  const packet = JSON.parse(read(path.join(author, 'staged/PACKET.json')).bytes);
  const inputs = [];
  for (const row of packet.files) {
    const actual = identity(path.join(author, 'staged', row.path), 1048576);
    assert.equal(actual.bytes, row.bytes); assert.equal(actual.sha256, row.sha256); inputs.push(actual);
  }
  const publication = read(path.join(author, 'publication-v2.mjs'));
  assert.equal(publication.input.sha256, 'f8ede5c4890135e0e68020cfc39007bd74f9d39d6402d6a31a6b031df2c9bf5f');
  inputs.push(publication.input);
  for (const name of ['review.mjs', 'finish.mjs', 'controls.mjs']) inputs.push(identity(path.join(root, name), 65536));
  const controlSeal = { schema: 'B2_R8_INDEPENDENT_FINITE_V2', packet: read(path.join(author, 'staged/PACKET.json')).input,
    inputs, cacheModule: path.join(author, 'staged/new/cache-census.mjs'), publicationModule: publication.input.path,
    supportModule: path.join(author, 'staged/new/support.mjs'), controlDeadline: '2026-08-29T16:46:15.000Z',
    groups: ['T01','T02','T03','T04','T05','T06','T07','T08-v2-api','V2-01','V2-02','N01','N02','N03','N04'],
    chronology: 'Independent expectations sealed after author source inspection, before independent execution',
    dataWorkMaximum: 1048576, childMaximum: 1, childMilliseconds: 15000, noProduct: true,
    qualification: 'T08 uses publication-v2 disjoint-root signature; same old identity obligations, not byte-identical old runner. No churn.' };
  const seal = owner.persist(path.join(root, 'PRESEAL.json'), controlSeal);
  await git('preseal-add', ['add', '--', relative]);
  await git('preseal-commit', ['commit', '--only', '-m', 'test: preseal independent B2 r8 finite delta controls', '--', relative]);
  const node = owner.config.tools.find(row => row.path.endsWith('/bin/node')); assert(node);
  const output = path.join(raw, 'controls');
  const execution = await owner.run('pure-controls', node.path, [path.join(root, 'controls.mjs'), seal.path, seal.sha256, output], 15000);
  assert.equal(execution.faults.primaryPresent, false);
  const result = read(path.join(output, 'RESULT.json'), 65536);
  const outcomes = JSON.parse(result.bytes);
  for (const row of inputs) assert.deepEqual(identity(row.path, 1048576), row);
  const source = read(path.join(author, 'staged/new/coordinator.mjs')).bytes.toString();
  const support = read(path.join(author, 'staged/new/support.mjs')).bytes.toString();
  assert(source.includes('accounting.beginCache(path.join(root, "cache"))'));
  assert(source.includes('assert.equal(manager.knownRetired(), true);'));
  assert(source.includes('accounting.cacheNeedsReconciliation() && manager.knownRetired()'));
  assert(support.includes('cachePhase = "failed";'));
  owner.persist(path.join(root, 'RESULT.json'), { ...outcomes, execution, packet: controlSeal.packet, sourceBindings: inputs,
    disposition: outcomes.fail === 0 ? 'QUALIFIED_SOURCE_PURE_PREEXEC_ACCEPT' : 'HOLD_CONTROL_FAILURE',
    retained: '38ff819e STOP0, original r7 224PASS448UNRUN/2types8diagnostics preserved',
    futureBinding: 'No window/GO; 672 future cases not executed; only these cache/publication changes reviewed',
    limits: 'best-effort non-atomic logical reserve; no actual npm peak/kernel quota/full transitive census proof',
    snapshotBeforePublication: owner.snapshot() });
  const handoff = `# B2 r8 independent SOURCE/PURE delta\n\nDisposition: ${outcomes.fail ? 'HOLD' : 'QUALIFIED SOURCE/PURE PREEXEC ACCEPT'}. ${outcomes.pass}/14 groups pass; ${outcomes.fail} fail.\n\nExact packet: 6945 bytes, SHA256 6df866e7990386218848061128777008bfbd6cdd93a7c0f658559fc0d0aa23f9; all 32 packet files freshly size/hash authenticated before helper imports and after execution. Publication-v2 SHA f8ede5c4890135e0e68020cfc39007bd74f9d39d6402d6a31a6b031df2c9bf5f separately bound.\n\nT01–T07 replay the old cache obligations; T08 uses publication-v2's explicit disjoint receipt root with the same identity/conflict obligations, not the old historical runner. V2-01/V2-02 cover legitimate copy.source.json payload, source identity and changed bytes, overlapping namespaces and destination tamper. N01 prefix-neighbor strictness, N02 accessor-code nonconsumption, N03 actual shipping ledger activation/reconciliation, N04 symlink cache-anchor refusal. No churn/native npm/product/Workers/compiler execution.\n\nActual future routing inspected: coordinator.mjs:64 activates only the explicitly confined install cache; :65 awaits manager.run, :66 requires known retirement, :67 reconciles before installed closure and subsequent roles. Catch :131 reconciles only if active and known-retired; it records failure rather than granting success. support.mjs:45 uses active sampling only during that phase; :55 admits exact roots[0]/cache, :58 rejects a symlink anchor, :63 sets failed before strict reconciliation, preserving reservation on failure. owner.mjs:78 calls the observer during managed execution; :90 records only known-role retirement. This is source qualification plus isolated ledger DATA, not execution of the complete future coordinator/npm route.\n\npublication-v2.mjs is the separately selected publication utility, not an assertion that coordinator imports it. The old publication.mjs remains historical. Physical owned-file controls verify disjoint metadata and payload behavior; no atomic whole-publication or persistence guarantee is added.\n\nThe read-once reviewer uses invocation-local sequential exclusive records and serves repeats from its same admitted Buffer. Original 38ff819e EEXIST/HOLD0 remains untouched. Child exit/close/streams are in RESULT; owner exit remains externally observed, not self-attested. No full process-group/transitive census claim.\n\nProspective policy unchanged: 128MiB cache reserve inside 512MiB logical work, ENOENT only active owned descendants, immutable/anchor/other errors strict; non-atomic best effort, not npm peak or kernel quota. Future 672/64-known-OS/1800 including180 publication/96MiB capture remains UNRUN and requires a separate window and GO. Original r7 224PASS448UNRUN/2types8diag unchanged.\n`;
  fs.writeFileSync(path.join(root, 'HANDOFF.md'), handoff, { flag: 'wx' });
  for (const [name, filename] of [['pure.stdout', execution.files[0]], ['pure.stderr', execution.files[1]]]) {
    const bytes = fs.readFileSync(filename); assert(bytes.length < 65536); fs.writeFileSync(path.join(root, name), bytes, { flag: 'wx' });
  }
  await git('evidence-add', ['add', '--', relative]);
  const commitOutput = await git('evidence-commit', ['commit', '--only', '-m', 'test: record independent B2 r8 source pure delta verdict', '--', relative]);
  return { disposition: outcomes.fail ? 'HOLD' : 'QUALIFIED_SOURCE_PURE_PREEXEC_ACCEPT', groups: outcomes, evidenceCommitOutput: commitOutput.toString(), snapshot: owner.snapshot() };
}
