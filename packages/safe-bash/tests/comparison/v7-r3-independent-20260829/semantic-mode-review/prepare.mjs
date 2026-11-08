import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const home = path.dirname(fileURLToPath(import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const source = path.join(repository, 'tests/comparison/breadth-continuation-20260828/executor-v7-r3/runs/semantic-mode-v1-20260829');
const base = path.resolve(source, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (value, code) => { if (!value) throw Error(code); };
const out = fs.openSync(path.join(home, 'PREPARATION.json'), 'wx', 0o600);
const read = (filename, cap = 262144) => {
  const stat = fs.lstatSync(filename);
  requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap && /\.(json|mjs|data|md)$/.test(filename) && path.basename(filename).toLowerCase() !== 'agents.md', 'TEXT_ADMISSION');
  const bytes = fs.readFileSync(filename);
  requireThat(bytes.length === stat.size, 'TEXT_CHANGED');
  return bytes;
};
const binding = filename => { const bytes = read(filename); return { path: filename, bytes: bytes.length, mode: fs.lstatSync(filename).mode & 511, sha256: hash(bytes) }; };
try {
  const sealBytes = read(path.join(source, 'SEAL.json'));
  requireThat(hash(sealBytes) === '357baeaa36eafdbd3e26c84b6483ec25a50061e22d179efec95ae362cafd065d', 'ROOT_SEAL');
  const seal = JSON.parse(sealBytes);
  const coreBytes = read(path.join(base, 'SEAL.json'));
  requireThat(hash(coreBytes) === 'bd4690d595751b99b3a2bf020f0063f86c03b23ae2600ecaa637be7dc6096b1c', 'CORE_SEAL');
  const core = JSON.parse(coreBytes);
  const declared = new Map();
  for (const row of core.files) {
    const name = path.resolve(base, row.path);
    if (name.startsWith(path.join(repository, 'tests/')) && /\.mjs$/.test(name)) declared.set(name, { ...row, path: name });
  }
  for (const row of [...seal.inherited, ...seal.files.map(row => ({ ...row, path: path.join(source, row.path) }))]) {
    const actual = binding(row.path);
    requireThat(actual.bytes === row.bytes && actual.mode === row.mode && actual.sha256 === row.sha256, 'SOURCE_BINDING');
    declared.set(row.path, actual);
  }
  const inputs = [...seal.inherited, ...seal.files.map(row => ({ ...row, path: path.join(source, row.path) }))];
  inputs.push(binding(path.join(source, 'SEAL.json')), binding(path.join(base, 'SEAL.json')));
  const generated = path.join(home, 'generated');
  fs.mkdirSync(generated, { mode: 0o755 });
  fs.mkdirSync(path.join(home, 'work'), { mode: 0o755 });
  const edits = [];
  const change = (text, before, after, label) => { requireThat(text.split(before).length === 2, 'EXACT_RELOCATION_' + label); edits.push({ label, before, after }); return text.replace(before, after); };
  function imports(text, fixture) {
    return text.replace(/from '([^']+)'/g, (whole, specifier) => {
      if (!specifier.startsWith('.')) return whole;
      const target = fixture && specifier === './fixtures.mjs' ? path.join(generated, 'fixtures.mjs') : path.resolve(source, specifier);
      return `from '${pathToFileURL(target).href}'`;
    });
  }
  let fixture = imports(read(path.join(source, 'fixtures.mjs')).toString(), false);
  fixture = change(fixture, "path.join(home,'evidence','fixtures',name)", `path.join(${JSON.stringify(path.join(home, 'work'))},'fixtures',name)`, 'fixture-output-only');
  fixture = change(fixture, 'wrongFirst=false,preparationFailure=false', 'wrongFirst=false,preparationFailure=false,tweak=null', 'independent-driver-hook-default-null');
  fixture = change(fixture, '  const terminalBytes=[];', '  if(tweak)tweak(drivers);\n  const terminalBytes=[];', 'independent-driver-hook-before-body');
  let controls = imports(read(path.join(source, 'controls.mjs')).toString(), true);
  controls = change(controls, "path.join(home,'evidence','budget')", `path.join(${JSON.stringify(path.join(home, 'work'))},'budget')`, 'budget-output-only');
  controls = change(controls, "path.join(home,'evidence','CONTROL-RESULT.json')", `path.join(${JSON.stringify(path.join(home, 'work'))},'CONTROL-RESULT.json')`, 'report-output-only');
  controls += '\nexport {positive,ordinary,report,grant};\n';
  for (const [name, text] of [['fixtures.mjs', fixture], ['controls.mjs', controls]]) fs.writeFileSync(path.join(generated, name), text, { flag: 'wx', mode: 0o644 });
  const own = ['prepare.mjs', 'dispatch.mjs', 'novel.mjs', 'parent.mjs', 'byte-stub.mjs', 'PLAN.md', 'generated/fixtures.mjs', 'generated/controls.mjs'].map(name => binding(path.join(home, name)));
  const data = { schema: 'SEMANTIC_INDEPENDENT_PRESEAL_V1', sourceCommit: '428cb8c0ec1c3aa1737c4138198bedce300ebea5', evidenceCommit: 'de91c4ef133104e345e18842ccd034da62f19a48', publicationCommit: 'edca806ff3deabfdb2a74c1b2bedab694ac0f2b7', source, home, rootSealSha256: hash(sealBytes), inputs, allowedModules: [...declared.values()], own, tools: seal.tools, edits, controls: { authorNew: 18, retainedAdmissionData: 3, independent: 12 }, maxChildren: 2, peak: 3, deadlineMs: 1200000, captureBytes: 201326592, workBytes: 805306368, actualEngines: 0, actualAdmission: 0, authorExpectationsUnchanged: true };
  const bytes = Buffer.from(JSON.stringify(data, null, 2) + '\n');
  requireThat(bytes.length <= 262144, 'PRESEAL_CAP');
  fs.writeFileSync(path.join(home, 'PRESEAL.json'), bytes, { flag: 'wx', mode: 0o644 });
  const receipt = { status: 'PREPARED_NOT_RUN', presealSha256: hash(bytes), changedInputs: seal.files.length, inheritedRechecked: seal.inherited.length, runtimeModulesAuthenticatedOnLoad: true, generatedEdits: edits.length, children: 0 };
  fs.writeSync(out, JSON.stringify(receipt, null, 2) + '\n'); fs.fsyncSync(out); fs.closeSync(out);
  process.stdout.write(JSON.stringify(receipt) + '\n');
} catch (error) { fs.writeSync(out, JSON.stringify({ status: 'HOLD', message: error.message }) + '\n'); fs.fsyncSync(out); fs.closeSync(out); throw error; }
