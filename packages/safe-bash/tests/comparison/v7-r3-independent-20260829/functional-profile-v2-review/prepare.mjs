import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const home = path.dirname(fileURLToPath(import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const source = path.join(repository, 'tests/comparison/breadth-continuation-20260828/executor-v7-r3/runs/semantic-functional-profile-v2-20260829');
const base = path.resolve(source, '../..');
const previous = path.resolve(home, '../semantic-mode-review');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (value, code) => { if (!value) throw Error(code); };
const output = fs.openSync(path.join(home, 'PREPARATION.json'), 'wx', 0o600);
function read(filename) {
  const info = fs.lstatSync(filename);
  requireThat(info.isFile() && !info.isSymbolicLink() && info.size <= 262144 && /\.(json|mjs|md|data)$/.test(filename) && path.basename(filename).toLowerCase() !== 'agents.md', 'TEXT_ADMISSION');
  const bytes = fs.readFileSync(filename); requireThat(bytes.length === info.size, 'TEXT_DRIFT'); return bytes;
}
const binding = filename => { const bytes = read(filename); return { path: filename, bytes: bytes.length, mode: fs.lstatSync(filename).mode & 511, sha256: hash(bytes) }; };
try {
  const sealBytes = read(path.join(source, 'SEAL.json'));
  requireThat(hash(sealBytes) === 'fb820b8b7d08ed2cd61af7d75c286ed133daa7a5457937061ffafd8e6982dce1', 'ROOT_SEAL');
  const seal = JSON.parse(sealBytes), coreBytes = read(path.join(base, 'SEAL.json'));
  requireThat(hash(coreBytes) === 'bd4690d595751b99b3a2bf020f0063f86c03b23ae2600ecaa637be7dc6096b1c', 'CORE_SEAL');
  const allowed = new Map();
  for (const row of JSON.parse(coreBytes).files) { const filename = path.resolve(base, row.path); if (filename.startsWith(path.join(repository, 'tests/')) && /\.mjs$/.test(filename)) allowed.set(filename, { ...row, path: filename }); }
  const inputs = [...seal.inherited, ...seal.files.map(row => ({ ...row, path: path.join(source, row.path) }))];
  for (const row of inputs) { const actual = binding(row.path); requireThat(actual.sha256 === row.sha256 && actual.bytes === row.bytes && actual.mode === row.mode, 'SOURCE_BINDING'); allowed.set(row.path, actual); }
  inputs.push(binding(path.join(source, 'SEAL.json')), binding(path.join(base, 'SEAL.json')));
  const generated = path.join(home, 'generated'), work = path.join(home, 'work');
  fs.mkdirSync(generated); fs.mkdirSync(work);
  const edits = [];
  function replace(text, before, after, label) { requireThat(text.split(before).length === 2, 'EXACT_RELOCATION_' + label); edits.push({ label, before, after }); return text.replace(before, after); }
  function imports(text, controls) { return text.replace(/from '([^']+)'/g, (whole, specifier) => specifier.startsWith('.') ? `from '${pathToFileURL(controls && specifier === './fixtures.mjs' ? path.join(generated, 'fixtures.mjs') : path.resolve(source, specifier)).href}'` : whole); }
  let fixture = imports(read(path.join(source, 'fixtures.mjs')).toString(), false);
  fixture = replace(fixture, "path.join(home,'evidence','fixtures',name)", `path.join(${JSON.stringify(work)},'fixtures',name)`, 'owned-fixture-output');
  fixture = replace(fixture, 'wrongFirst=false,preparationFailure=false,unsafeFirst=false', 'wrongFirst=false,preparationFailure=false,unsafeFirst=false,tweak=null', 'default-null-novel-hook');
  fixture = replace(fixture, '  const terminalBytes=[];', '  if(tweak)tweak(drivers);\n  const terminalBytes=[];', 'novel-hook-before-body');
  let controls = imports(read(path.join(source, 'controls.mjs')).toString(), true);
  controls = replace(controls, "path.join(home,'evidence','budget')", `path.join(${JSON.stringify(work)},'budget')`, 'owned-budget-output');
  controls = replace(controls, "path.join(home,'evidence','CONTROL-RESULT.json')", `path.join(${JSON.stringify(work)},'CONTROL-RESULT.json')`, 'owned-control-output');
  controls += '\nexport {positive,ordinary,report,grant};\n';
  for (const [name, text] of [['fixtures.mjs', fixture], ['controls.mjs', controls]]) fs.writeFileSync(path.join(generated, name), text, { flag: 'wx', mode: 0o644 });
  const parentSource = read(path.join(previous, 'parent.mjs'));
  const parentBinding = binding(path.join(previous, 'parent.mjs'));
  fs.writeFileSync(path.join(home, 'parent.mjs'), parentSource, { flag: 'wx', mode: 0o644 });
  const own = ['prepare.mjs', 'parent.mjs', 'dispatch.mjs', 'novel.mjs', 'PLAN.md', 'generated/fixtures.mjs', 'generated/controls.mjs'].map(name => binding(path.join(home, name)));
  const manifest = { schema: 'FUNCTIONAL_V2_INDEPENDENT_PRESEAL', sourceCommit: '45dd71f18882900070c5a925a5c01e0a6045aa5b', evidenceCommit: '1643534558e978513d16be55dd5580ad717416ca', source, home, rootSealSha256: hash(sealBytes), inputs, allowedModules: [...allowed.values()], own, tools: seal.tools, parentBinding, edits, controls: { authorFamilies: 14, retainedAdmissionData: 3, novel: 12 }, deadlineMs: 900000, captureBytes: 134217728, workBytes: 805306368, maxControlProcesses: 2, actualEngines: 0, authorExpectationsUnchanged: true };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n'); requireThat(bytes.length <= 262144, 'PRESEAL_CAP');
  fs.writeFileSync(path.join(home, 'PRESEAL.json'), bytes, { flag: 'wx', mode: 0o644 });
  const result = { status: 'PREPARED_NOT_RUN', presealSha256: hash(bytes), successor: seal.files.length, inherited: seal.inherited.length, controls: manifest.controls, outputOnlyRelocationAndDefaultNullHook: edits, children: 0 };
  fs.writeSync(output, JSON.stringify(result, null, 2) + '\n'); fs.fsyncSync(output); fs.closeSync(output); process.stdout.write(JSON.stringify({ status: result.status, presealSha256: result.presealSha256 }) + '\n');
} catch (error) { fs.writeSync(output, JSON.stringify({ status: 'HOLD', message: error.message }) + '\n'); fs.fsyncSync(output); fs.closeSync(output); throw error; }
