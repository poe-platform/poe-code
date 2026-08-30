import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root = '/Users/kjopek/Workspace/safe-bash';
const base = 'tests/integration/agent-bash-coherent-author-20260829';
const scope = path.join(root, base, 'stage-b1-r4');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function admit(relative, expected, ceiling = 262144) {
  const filename = path.join(root, relative); const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.ok(stat.size <= ceiling);
  if (expected) assert.equal(stat.size, expected.bytes);
  const bytes = fs.readFileSync(filename); assert.equal(bytes.length, stat.size);
  if (expected) assert.equal(hash(bytes), expected.sha256);
  return bytes;
}
function save(name, value) { fs.writeFileSync(path.join(scope, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
const oldSeal = JSON.parse(admit(`${base}/stage-b1-r3/PRESEAL.json`, { bytes: 18947, sha256: '46c2a7a10054de35547b7aaae7d0c6fc3776920f5de5da8f84002d16b53e4d6e' }));
if (process.argv[2] === 'inspect') {
  const items = [`${base}/stage-b1-r2/consumer.mjs`, `${base}/stage-b1-publication-v2/BINDING-v2.json`, `${base}/stage-b1-publication-v2/publish.mjs`, `${base}/stage-b1-publication-v2/publication.sh`];
  for (const relative of items) {
    const expected = oldSeal.files.find(row => row.path === relative);
    const bytes = admit(relative, expected); const identity = { path: relative, bytes: bytes.length, sha256: hash(bytes), inheritedRuntimeBinding: !!expected };
    save('inspect-' + path.basename(relative) + '.json', identity);
    console.log(JSON.stringify(identity));
    const lines = bytes.toString('utf8').split('\n');
    console.log(lines.map((line, index) => `${index + 1}: ${line}`).join('\n'));
  }
  save('STAGED.json', oldSeal.stageFiles);
  console.log(JSON.stringify({ stageFiles: oldSeal.stageFiles, utc: new Date().toISOString(), pid: process.pid }));
} else if (process.argv[2] === 'patch') {
  const bound = relative => {
    const entry = oldSeal.files.find(row => row.path === relative); assert.ok(entry); return admit(relative, entry).toString('utf8');
  };
  const fixture = bound(`${base}/v4/workflows.mjs`);
  const first = fixture.indexOf("    } else if (id === 'C18') {");
  const last = fixture.indexOf('\n    }\n    facts.status', first); assert.ok(first > 0 && last > first);
  const body = [
    "    } else if (id === 'C18') {",
    "      facts.phase = 'collision-register';",
    "      const collided = make(); const original = { name: 'node', execute() { return { exitCode: 99 }; } }; collided.commands.register(original);",
    "      const registered = collided.commands.get('node'); assert.notEqual(registered, original); assert.equal(registered.execute, original.execute);",
    "      let setupFailure, setupFailurePresent = false, setupFailures = 0;",
    "      const collisionPlugin = nodeApi.nodeCommands({ provider: inert, grants: {} });",
    "      collided.use({ name: collisionPlugin.name, setup(host) { try { return collisionPlugin.setup(host); } catch (reason) { setupFailurePresent = true; setupFailures++; setupFailure = reason; events.push('collision-setup-rejected'); throw reason; } } });",
    "      facts.phase = 'collision-exec';",
    "      const result = await outcome(collided.exec('true')); assert.equal(result.kind, 'throw'); assert.equal(setupFailurePresent, true); assert.equal(setupFailures, 1); assert.equal(result.reason, setupFailure); assert.equal(result.reason.message, 'Command already registered: node');",
    "      facts.phase = 'registered-identity'; assert.equal(collided.commands.get('node'), registered); assert.equal(prepares, 0);",
    "      facts.phase = 'collision-dispose'; const disposed = await outcome(collided.dispose()); assert.equal(disposed.kind, 'return'); assert.equal(setupFailures, 1); events.push('collision-disposed');",
    "      const ownerIndex = shells.indexOf(collided); shells.splice(ownerIndex, 1);",
    "      facts.phase = 'replacement-register';",
    "      const shell = make(), options = { provider: realProvider(), grants: { stdoutWrite: true, stderrWrite: true }, replace: true };",
    "      shell.commands.register(original); const plugin = nodeApi.nodeCommands(options); options.replace = false; options.provider = null; options.grants.stdoutWrite = false;",
    "      shell.use(plugin); facts.phase = 'replacement-exec'; await expect(shell, \"node -p '8'\", '8\\n'); assert.equal(prepares, 1); facts.phase = 'complete';",
  ].join('\n');
  const workflow = fixture.slice(0, first) + body + fixture.slice(last);
  const consumerOld = bound(`${base}/stage-b1-r2/consumer.mjs`);
  const oldRow = "rows.push({ id, status: 'FAIL', primaryPresent: true, reason: { type: typeof reason, description: String(reason) }, facts: reason?.facts });";
  assert.equal(consumerOld.split(oldRow).length, 2);
  const consumer = consumerOld.replace("import fs from 'node:fs';", "import fs from 'node:fs';\nimport { captureFailure } from './failure.mjs';").replace(oldRow, "rows.push({ id, status: 'FAIL', ...captureFailure(reason, reason?.facts?.phase), facts: reason?.facts });");
  const run = bound(`${base}/stage-b1-r3/run.mjs`).replace("from './layout.mjs'", "from '../stage-b1-r3/layout.mjs'");
  const bootstrap = bound(`${base}/stage-b1-r3/bootstrap.mjs`);
  const launch = bound(`${base}/stage-b1-r3/launch.sh`).replaceAll('stage-b1-r3/bootstrap.mjs', 'stage-b1-r4/bootstrap.mjs').replaceAll('20260829-r3.launch.', '20260829-r4.launch.');
  const publisherBindingIdentity = { bytes: 3923, sha256: '022ff1fc4ec15f25ef937419062a69ade7a0b3e3df482a0dcea7318e802fce56' };
  const publication = JSON.parse(admit(`${base}/stage-b1-publication-v2/BINDING-v2.json`, publisherBindingIdentity));
  const publisher = name => { const relative = `${base}/stage-b1-publication-v2/${name}`; const entry = publication.files.find(row => row.path === relative); assert.ok(entry); return admit(relative, entry).toString('utf8'); };
  const publish = publisher('publish.mjs').replaceAll('stage-b1-publication-v2', 'stage-b1-r4');
  const policy = publisher('policy.mjs');
  const publicationShell = publisher('publication.sh').replaceAll('stage-b1-publication-v2/publish.mjs', 'stage-b1-r4/publish.mjs').replaceAll('coherent-b1-publication-v2-20260829', 'coherent-b1-publication-r4-20260829');
  const files = [['workflows.mjs', workflow], ['consumer.mjs', consumer], ['run.mjs', run], ['bootstrap.mjs', bootstrap], ['launch.sh', launch], ['publish.mjs', publish], ['policy.mjs', policy], ['publication.sh', publicationShell]];
  let patch = '*** Begin Patch\n';
  for (const [name, text] of files) { assert.ok(text.endsWith('\n')); patch += `*** Add File: ${base}/stage-b1-r4/${name}\n` + text.slice(0, -1).split('\n').map(line => '+' + line).join('\n') + '\n'; }
  fs.writeFileSync(path.join(scope, 'source.patch'), patch + '*** End Patch\n', { flag: 'wx' });
  save('EXPECTED-SOURCE.json', files.map(([name, text]) => ({ path: name, bytes: Buffer.byteLength(text), sha256: hash(Buffer.from(text)) })));
  save('FIXTURE-DELTA.json', { old: { path: `${base}/v4/workflows.mjs`, bytes: Buffer.byteLength(fixture), sha256: hash(Buffer.from(fixture)) }, prefixBytes: Buffer.byteLength(fixture.slice(0, first)), prefixSha256: hash(Buffer.from(fixture.slice(0, first))), suffixBytes: Buffer.byteLength(fixture.slice(last)), suffixSha256: hash(Buffer.from(fixture.slice(last))), changedIds: ['C18'], other17WorkflowBodies: 'BYTE_UNCHANGED', oldResult: '8 PASS / 2 FAIL / 5 UNRUN retained, no rescore' });
  console.log(JSON.stringify({ phase: 'patch', files: files.length, utc: new Date().toISOString(), pid: process.pid }));
} else if (process.argv[2] === 'seal') {
  const candidate = process.argv[3]; assert.match(candidate, /^[a-f0-9]{40}$/);
  const identity = name => { const bytes = admit(`${base}/stage-b1-r4/${name}`); return { bytes: bytes.length, sha256: hash(bytes) }; };
  for (const entry of JSON.parse(admit(`${base}/stage-b1-r4/EXPECTED-SOURCE.json`))) admit(`${base}/stage-b1-r4/${entry.path}`, entry);
  const seal = structuredClone(oldSeal); seal.workRoot = '/private/tmp/safe-bash-coherent-b1-public15-20260829-r4'; assert.equal(fs.existsSync(seal.workRoot), false);
  const origins = [];
  for (const target of ['consumer.mjs', 'workflows.mjs', 'failure.mjs']) {
    const source = `${base}/stage-b1-r4/${target}`; const info = identity(target);
    const old = seal.stageFiles.find(row => row.target === target);
    const replacement = { path: source, source, target, ...info, origin: { kind: 'NEW_B1_R4_SOURCE', repositoryPath: source, sourceCommit: candidate, ...info } };
    if (old) seal.stageFiles[seal.stageFiles.indexOf(old)] = replacement; else seal.stageFiles.push(replacement);
    origins.push({ target, before: old ?? null, after: replacement });
  }
  for (const name of ['run.mjs', 'bootstrap.mjs', 'launch.sh', 'consumer.mjs', 'workflows.mjs', 'failure.mjs']) seal.files.push({ path: `${base}/stage-b1-r4/${name}`, ...identity(name) });
  seal.successor = { sourceCommit: candidate, baseline: { bytes: 18947, sha256: '46c2a7a10054de35547b7aaae7d0c6fc3776920f5de5da8f84002d16b53e4d6e' }, changedFixtureIds: ['C18'], addedImportEdge: 'consumer.mjs -> ./failure.mjs -> node:util', changedConsumerCapture: 'bounded own-data cause/phase, no coercion/stack/object traversal', authority: 'NO_ACTUAL_GO_OR_UTC_WINDOW' };
  save('PRESEAL.json', seal); save('ORIGIN-DELTA.json', origins);
  const publication = JSON.parse(admit(`${base}/stage-b1-publication-v2/BINDING-v2.json`, { bytes: 3923, sha256: '022ff1fc4ec15f25ef937419062a69ade7a0b3e3df482a0dcea7318e802fce56' }));
  publication.candidate = candidate; publication.runtimePreseal = { path: `${base}/stage-b1-r4/PRESEAL.json`, ...identity('PRESEAL.json') };
  publication.files = publication.files.map(entry => { const name = path.basename(entry.path); return ['publish.mjs', 'policy.mjs', 'publication.sh'].includes(name) ? { path: `${base}/stage-b1-r4/${name}`, ...identity(name) } : entry; });
  publication.windows = 'NONE: pending different review and fresh final-slot authority'; publication.rootActualAuthority = false;
  publication.outputs.work = seal.workRoot;
  publication.outputs.evidence = path.join(scope, 'actual-evidence');
  publication.outputs.publication = '/private/tmp/coherent-b1-publication-r4-20260829-results';
  publication.outputs.launchCaptures = ['stdout', 'stderr'].map(suffix => `/private/tmp/coherent-b1-public15-20260829-r4.launch.${suffix}`);
  publication.outputs.startupCaptures = ['stdout', 'stderr'].map(suffix => `/private/tmp/coherent-b1-publication-r4-20260829.startup.${suffix}`);
  for (const filename of [publication.outputs.work, publication.outputs.evidence, publication.outputs.publication, ...publication.outputs.launchCaptures, ...publication.outputs.startupCaptures]) assert.equal(fs.existsSync(filename), false);
  save('PUBLICATION-BINDING.json', publication);
  const controls = { schema: 'B1-r4-DATA-preseal-v1', sourceCommit: candidate, groups: ['D01','D02','D03','D04','D05','D06','D07','D08'], controllerCount: 1, productCalls: 0, Workers: 0, seconds: 30, files: ['failure.mjs','controls.mjs','workflows.mjs','consumer.mjs','run.mjs','publish.mjs','policy.mjs','PUBLICATION-BINDING.json','FIXTURE-DELTA.json'].map(name => ({ path: name, ...identity(name) })), oldFixture: oldSeal.stageFiles.find(row => row.target === 'workflows.mjs'), oldPublication: { path: `${base}/stage-b1-publication-v2/BINDING-v2.json`, bytes: 3923, sha256: '022ff1fc4ec15f25ef937419062a69ade7a0b3e3df482a0dcea7318e802fce56' } };
  save('CONTROL-PRESEAL.json', controls);
  save('SEAL-RECEIPT.json', { sourceCommit: candidate, preseal: identity('PRESEAL.json'), publication: identity('PUBLICATION-BINDING.json'), controls: identity('CONTROL-PRESEAL.json'), utc: new Date().toISOString(), pid: process.pid, actualCalls: 0 });
  console.log(JSON.stringify(JSON.parse(admit(`${base}/stage-b1-r4/SEAL-RECEIPT.json`))));
} else throw new Error('unknown source-only preparation mode');
