import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url)), repository = resolve(directory, '../../..');
const execution = realpathSync(mkdtempSync(join(tmpdir(), 'html-markdown-compiled-')));
const output = realpathSync(mkdtempSync(join(tmpdir(), 'html-markdown-compiled-evidence-')));
const report = { scope: 'Module-local compiled consumers, not root/package export acceptance', phases: [], cases: [], cleanup: false };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceRevision = '2272feb92f8c0f151385f59f79eee004c50d14b8';
function inventory(root) {
  const files = {};
  const visit = directory => { for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else { assert.ok(entry.isFile()); files[path.slice(root.length + 1)] = hash(readFileSync(path)); }
  } };
  visit(root); return files;
}
const command = (label, args, expected = 0) => {
  const result = spawnSync(process.execPath, args, { cwd: repository, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(join(output, label + '.stdout'), result.stdout ?? ''); writeFileSync(join(output, label + '.stderr'), result.stderr ?? '');
  report.phases.push({ label, args, status: result.status, error: result.error?.message });
  assert.equal(result.status, expected, label + '\n' + result.stdout + result.stderr);
  return result;
};
try {
  report.node = { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) };
  report.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository }).toString().trim();
  report.moduleSourceRevision = sourceRevision;
  for (const name of readdirSync(join(repository, 'src/commands/html-to-markdown'))) {
    const path = 'src/commands/html-to-markdown/' + name;
    assert.deepEqual(readFileSync(join(repository, path)), execFileSync('git', ['--no-replace-objects', 'show', sourceRevision + ':' + path], { cwd: repository }));
  }
  const compiler = join(repository, 'node_modules/typescript/bin/tsc');
  const listed = command('input-census', [compiler, '-p', join(directory, 'tsconfig.build.json'), '--listFilesOnly']);
  const sourcePaths = listed.stdout.split('\n').filter(path => path.startsWith(repository + '/src/'));
  report.sourceInputs = Object.fromEntries(sourcePaths.map(path => [path.slice(repository.length + 1), hash(readFileSync(path))]));
  command('build', [compiler, '-p', join(directory, 'tsconfig.build.json'), '--outDir', join(execution, 'build')]);
  report.emittedBefore = inventory(join(execution, 'build'));
  writeFileSync(join(execution, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  writeFileSync(join(execution, 'consumer.mts'), readFileSync(join(directory, 'compiled-consumer.mts.fixture')));
  const flags = [compiler, '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--typeRoots', join(repository, 'node_modules/@types')];
  command('consumer-types', [...flags, join(execution, 'consumer.mts')]);
  for (const [name, value] of [['wrong-limit', "{limits:{maxDepth:'bad'}}"], ['wrong-replace', "{replace:3}"], ['unknown-limit', "{limits:{unbounded:true}}"]]) {
    const file = join(execution, name + '.mts'); writeFileSync(file, `import {htmlToMarkdownCommands} from './build/commands/html-to-markdown/index.js'; htmlToMarkdownCommands(${value});`);
    const result = command(name, [...flags, file], 2); assert.match(result.stdout, /TS(?:2322|2353)/u);
  }
  const runtime = `import assert from 'node:assert/strict';
import {createHtmlToMarkdownCommand,htmlToMarkdownCommands} from './build/commands/html-to-markdown/index.js';
import {MemoryFileSystem} from './build/fs/memory/index.js';
import {CommandRegistry,toByteSource} from './build/contracts/index.js';
const fs=new MemoryFileSystem();await fs.writeFile('/page',Buffer.from('<h1>Release</h1>'));
const commands=new CommandRegistry();await htmlToMarkdownCommands().setup({commands,use(){},registerFileSystem(){}});
const cases=[['file',['/page'],'','# Release\\n'],['stdin',[],'<b>yes</b>','**yes**\\n'],['blocked',[],'<a href="javascript:alert(1)">label</a>','label\\n'],['utf8',[],'<p>中文 😀</p>','中文 😀\\n']];
for(const [name,args,html,expected]of cases){let stdout='',stderr='';const hooks=[];const result=await commands.get('html-to-markdown').execute({command:'html-to-markdown',args,stdin:toByteSource(html),stdout:{async write(bytes){stdout+=Buffer.from(bytes).toString()}},stderr:{async write(bytes){stderr+=Buffer.from(bytes).toString()}},cwd:'/',env:{},fs,signal:new AbortController().signal,registerCleanup(callback){hooks.push(callback)}});for(const hook of hooks)await hook();assert.equal(result.exitCode,0);assert.equal(stderr,'');assert.equal(stdout,expected,name)}
assert.equal(createHtmlToMarkdownCommand().name,'html-to-markdown');console.log(JSON.stringify({passed:cases.length,module:import.meta.resolve('./build/commands/html-to-markdown/index.js')}));`;
  writeFileSync(join(execution, 'runtime.mjs'), runtime);
  const result = command('runtime', ['--experimental-permission', '--allow-fs-read=' + execution, join(execution, 'runtime.mjs')]);
  report.runtime = JSON.parse(result.stdout);
  assert.ok(report.runtime.module.startsWith('file://' + execution + '/build/'));
  writeFileSync(join(execution, 'denial.mjs'), `import{readFileSync}from'node:fs';readFileSync(${JSON.stringify(join(repository, 'src/commands/html-to-markdown/index.ts'))});`);
  const denial = command('source-denial', ['--experimental-permission', '--allow-fs-read=' + execution, join(execution, 'denial.mjs')], 1);
  assert.match(denial.stderr, /ERR_ACCESS_DENIED/u);
  const entry = join(execution, 'build/commands/html-to-markdown/index.js');
  renameSync(entry, entry + '.held');
  try {
    const missing = command('missing-module', ['--experimental-permission', '--allow-fs-read=' + execution, join(execution, 'runtime.mjs')], 1);
    assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND/u);
  } finally { renameSync(entry + '.held', entry); }
  report.emittedAfter = inventory(join(execution, 'build')); assert.deepEqual(report.emittedAfter, report.emittedBefore);
  for (const [path, expected] of Object.entries(report.sourceInputs)) assert.equal(hash(readFileSync(join(repository, path))), expected, path);
  report.status = 'pass';
} catch (error) { report.status = 'fail'; report.error = String(error.stack); process.exitCode = 1; }
finally { rmSync(execution, { recursive: true, force: true }); report.cleanup = true; writeFileSync(join(output, 'REPORT.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ output, status: report.status, runtime: report.runtime, error: report.error })); }
