import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { authenticatePacket } from './authorization.mjs';
import { boundFile, directories, authenticateView, viewProjection, parseStage, tarMembers } from './projection.mjs';
import { hash, requireThat, candidate, pack } from './safety.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = filename => JSON.parse(fs.readFileSync(path.join(root, filename)));
const projection = read('PROJECTION.json');
const recipe = authenticatePacket(root);
const seal = read('SEAL.json');
const checks = [];
function check(id, value) { checks.push({ id, pass: Boolean(value) }); }
for (const tool of projection.tools) boundFile(tool.path, tool);
check('candidate', projection.candidate === candidate);
check('target-pack', projection.target.pack.sha256 === pack && projection.target.files.length === 858);
check('baseline-3.4.2', projection.baseline.version === '3.4.2' && projection.baseline.closure.files.length === 3844);
check('instruction-projection', projection.baseline.excluded.length === 1 && projection.baseline.closure.files.filter(file => file.path.split('/').some(part => part.toUpperCase() === 'AGENTS.MD')).length === 1);
const sourceFiles = projection.baseline.closure.files.filter(file => !projection.baseline.excluded.some(entry => entry.path === file.path));
check('bound-staging-size', sourceFiles.reduce((total, entry) => total + entry.bytes, 0) + 2 * projection.target.files.reduce((total, entry) => total + entry.bytes, 0) < 160 * 1024 * 1024);
check('unique-closure', new Set(sourceFiles.map(file => file.path)).size === 3843);
check('locks-membership', projection.baseline.locks.every(name => sourceFiles.some(file => file.path === name)));
check('assets-membership', projection.baseline.assets.every(name => sourceFiles.some(file => file.path === name)));
const workflows = read('../WORKFLOWS.json').rows;
const legacy = read('../LEGACY-RECIPES.json').rows;
const specimens = new Map([...workflows, ...legacy.map(row => row.recipe)].map(row => [row.id, row]));
check('23-10-distinct', legacy.length === 23 && workflows.length === 10 && specimens.size === 33);
const schedule = read('../executor-preparation-v1/SCHEDULE.json').rows;
check('99-executions', schedule.length === 99);
check('exact-schedule-bindings', schedule.every(row => hash(JSON.stringify(specimens.get(row.id))) === row.recipeSha256));
check('66-target-setups', schedule.filter(row => row.layout.startsWith('target-')).length === 66);
check('three-layouts', ['target-installed', 'target-moved', 'baseline-installed'].every(layout => schedule.filter(row => row.layout === layout).length === 33));
const namespaces = read('../executor-overlay-v2/NAMESPACES.json').engines;
check('namespace-profile', namespaces['virtual-bash'].maxTotalEntries === 68 && namespaces['just-bash'].maxTotalEntries === 255);
check('directories-finite', directories(sourceFiles).length < 2000);
for (const name of ['target-installed', 'target-moved', 'baseline-installed']) {
  const expected = viewProjection(projection, name);
  const view = { name, root: `/frozen/${name}`, files: expected.files, engine: expected.engine, consumerPath: expected.consumerPath, oldOrigin: name === 'target-moved' ? '/frozen/move-origin' : null };
  check(`view:${name}`, authenticateView(projection, view));
  for (const [label, altered] of [['missing-file', { ...view, files: view.files.slice(1) }], ['wrong-engine', { ...view, engine: 'unbound' }], ['wrong-consumer', { ...view, consumerPath: 'source-fallback.mjs' }]]) {
    let caught;
    try { authenticateView(projection, altered); } catch (error) { caught = error; }
    check(`view:${name}:${label}`, caught?.code === 'VIEW_PROJECTION_BINDING');
  }
}
const stageBytes = Buffer.from('{"views":{}}');
check('stage-hash-positive', Object.keys(parseStage(stageBytes, hash(stageBytes)).views).length === 0);
let stageRejection;
try { parseStage(Buffer.from('{"views":{"unlisted":{}}}'), hash(stageBytes)); } catch (error) { stageRejection = error; }
check('stage-hash-tamper', stageRejection?.code === 'STAGED_HASH');
const packBytes = boundFile(projection.target.pack.physical, projection.target.pack);
check('858-pack-data-members', tarMembers(packBytes, projection.target.files).size === 858);
check('comparator-archive-data-hash', boundFile(projection.baseline.archive.physical, projection.baseline.archive).length === projection.baseline.archive.bytes);
const node = projection.tools.find(tool => tool.role === 'node').path;
for (const entry of seal.files.filter(entry => !entry.path.startsWith('../') && /\.(mjs|cjs)$/.test(entry.path))) {
  execFileSync(node, ['--check', path.join(root, entry.path)], { timeout: 10000, maxBuffer: 65536, env: { PATH: '', LANG: 'C', HOME: root } });
  check(`syntax:${entry.path}`, true);
}
const result = { schema: 'v3-data-and-syntax-only', recipe, checks, passed: checks.filter(row => row.pass).length, failed: checks.filter(row => !row.pass).length, productsImported: 0, comparatorImported: 0, native: 0, cohort: 0 };
requireThat(authenticatePacket(root) === recipe, 'POST_RECIPE', recipe);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.failed) process.exitCode = 1;
