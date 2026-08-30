import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { blob, controls, directory, identify, inventory, pins, repo, save, sha } from './bind.mjs';
import { compose } from './workspace.mjs';

controls();
const inputs = resolve(directory, 'tool-inputs'); mkdirSync(inputs);
const links = [];
const copy = (source, target) => {
  const resolved = realpathSync(source); const stat = lstatSync(resolved);
  if (resolved !== source) links.push({ source, resolved });
  if (stat.isDirectory()) { mkdirSync(target, { recursive: true, mode: stat.mode & 511 }); for (const name of readdirSync(resolved).sort()) copy(resolve(resolved, name), resolve(target, name)); }
  else { assert(stat.isFile()); mkdirSync(dirname(target), { recursive: true }); copyFileSync(resolved, target, 1); chmodSync(target, stat.mode & 511); }
};
mkdirSync(resolve(inputs, 'node'));
copy(process.execPath, resolve(inputs, 'node/node'));
const origins = { node: process.execPath, typescript: resolve(repo, 'node_modules/typescript'), nodeTypes: resolve(repo, 'node_modules/@types/node'), undiciTypes: resolve(repo, 'node_modules/undici-types'), npm: resolve(dirname(realpathSync('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/npm')), '..') };
for (const role of ['typescript', 'nodeTypes', 'undiciTypes', 'npm']) copy(origins[role], resolve(inputs, role));
const entries = { node: 'node', typescript: 'lib/typescript.js', npm: 'bin/npm-cli.js' };
const roots = Object.fromEntries(Object.keys(origins).map(role => [role, { source: resolve(inputs, role), inventory: inventory(resolve(inputs, role)), ...(entries[role] ? { entrypoint: entries[role] } : {}) }]));
save('TOOLS.json', { schema: 1, roots });
save('TOOL-ORIGINS.json', { origins, resolvedLinks: links, inventory: inventory(inputs), nodeVersion: process.version, note: 'Regular byte/mode copies; no tool or package installation/download. Source links explicitly resolved into regular owned files.' });
const binding = JSON.parse(readFileSync(resolve(directory, 'BINDING.json')));
const files = compose(binding);
writeFileSync(resolve(directory, 'composition.json.gz'), gzipSync(JSON.stringify({ binding, files: Object.fromEntries(Object.entries(files).map(([path, entry]) => [path, { ...entry, bytes: undefined, base64: entry.bytes.toString('base64') }])) }), { level: 9 }), { flag: 'wx' });
const compiler = (await import(pathToFileURL(resolve(inputs, 'typescript/lib/typescript.js')).href)).default;
const parse = text => compiler.createSourceFile('runtime.ts', text, compiler.ScriptTarget.ES2023, true, compiler.ScriptKind.TS);
const baseline = parse(blob(pins.baseline, 'src/shell/runtime.ts').toString());
const candidate = parse(blob(pins.candidate, 'src/shell/runtime.ts').toString());
const runtime = source => source.statements.find(node => compiler.isClassDeclaration(node) && node.name.text === 'Runtime');
const members = source => runtime(source).members.filter(node => node.name?.getText(source) !== 'builtin');
assert.equal(members(baseline).length, 58); assert.equal(members(candidate).length, 58);
const memberProof = members(baseline).map((node, index) => { const other = members(candidate)[index]; assert.equal(node.getText(baseline), other.getText(candidate)); return { name: node.name?.getText(baseline) ?? 'constructor', sha256: sha(node.getText(baseline)), baselineLine: baseline.getLineAndCharacterOfPosition(node.getStart(baseline)).line + 1, candidateLine: candidate.getLineAndCharacterOfPosition(other.getStart(candidate)).line + 1 }; });
const builtin = source => runtime(source).members.find(node => node.name?.getText(source) === 'builtin');
const cd = node => compiler.isIfStatement(node) && node.expression.getText().replaceAll(' ', '') === 'command==="cd"';
const statements = source => builtin(source).body.statements.filter(node => !cd(node));
assert.deepEqual(statements(baseline).map(node => node.getText(baseline)), statements(candidate).map(node => node.getText(candidate)));
const added = new Set(['cdUtf8Width', 'cdDiagnostic', 'CdLookup']);
const top = source => source.statements.filter(node => node !== runtime(source) && !added.has(node.name?.text)).map(node => node.getText(source).replace('ACCESS_MODES, FsError,', 'ACCESS_MODES,'));
assert.deepEqual(top(baseline), top(candidate));
save('SOURCE-REVIEW.json', { stage: 'after binding preseal3d817486; static candidate AST/byte review, not runtime pass', compiler: { version: compiler.version, sha256: sha(readFileSync(resolve(inputs, 'typescript/lib/typescript.js'))) }, runtime: identify(pins.candidate, 'src/shell/runtime.ts'), baselineRuntime: identify(pins.baseline, 'src/shell/runtime.ts'), otherMembers: memberProof, nonCdBuiltinStatements: statements(candidate).length, nonCdBuiltinStatementsByteIdentical: true, otherTopLevelStatementsIdenticalExceptFsErrorImport: true, helpers: [...added].map(name => { const node = candidate.statements.find(entry => entry.name?.text === name); return { name, sha256: sha(node.getText(candidate)), line: candidate.getLineAndCharacterOfPosition(node.getStart(candidate)).line + 1, text: node.getText(candidate) }; }), cdBranch: builtin(candidate).body.statements.find(cd).getText(candidate), facts: ['No Budget/state initializer/clone/writeVariable/prefix/error/caller-cancellation/cleanup member change', 'OLDPWD checked write precedes cwd; PWD checked write follows cwd; exports precede awaited print', 'Typed continuation only FsError ENOENT/ENOTDIR/EACCES; fresh unconditional final fallback', 'Raw reservation2R before join; normalized scanN then stat/access charges; subtraction-first quota check and every128 boundary yields', 'cdDiagnostic is reached by injected EIO.message payload through actual cd catch, not a helper simulation'] });
save('ROOT-ROUTE.json', { authorization: 'ROOT_EXECUTION_AUTHORIZED', reference: 'ROOT user route of4641075df5355a91c83bf5b2cc3a88dfaf1f5153 evidence8c0c17f; actual review authorized after candidate-binding preseal3d8174864eeed5c5cda4d6f1db22c2b7673b3639', candidateCommit: binding.candidateCommit, bindingSha256: sha(JSON.stringify(binding)), modes: ['source', 'installed', 'moved'], outputDirectory: resolve(directory, 'attempt-01'), authorizedWriteRoot: resolve(directory, 'attempt-01'), tools: { manifestPath: resolve(directory, 'TOOLS.json'), manifestSha256: sha(readFileSync(resolve(directory, 'TOOLS.json'))) } });
save('ADAPTATION-v1.json', { stage: 'post-candidate binding, before product execution', originalPreparation: pins.preparation, unchanged: ['fixtures.mjs', 'mapping.mjs', 'series.mjs', 'entry.mjs', 'workspace.mjs', 'run.mjs'], changes: ['common: authenticate all41 prior files plus author/native/provider historical files; authorize only new review-owned output subdirectory', 'types: explicitly use baseline lib.es2023.d.ts; no DOM library, no fixture or expected diagnostic change'], sourceProjectionFiles: Object.keys(files).length, sourceArchiveSha256: sha(readFileSync(resolve(directory, 'composition.json.gz'))), scriptInventory: Object.fromEntries(Object.entries(inventory(directory)).filter(([path, entry]) => !path.startsWith('tool-inputs') && entry.kind === 'file')), runtimeExecution: 0 });
console.log(JSON.stringify({ sourceFiles: Object.keys(files).length, identicalOtherMembers: memberProof.length, nonCdStatements: statements(candidate).length, compiler: compiler.version }));
