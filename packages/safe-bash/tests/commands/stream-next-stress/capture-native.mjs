import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, readlinkSync, writeFileSync, linkSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpus, workflows, contractPlan } from './corpus.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, '../../..');
const gate = '/tmp/safe-bash-stream-next-reviewer.ready';
if (!existsSync(gate)) throw new Error('Root preparation release absent');
mkdirSync(join(owned, '.private'), { recursive: true });
const scratch = mkdtempSync(join(owned, '.private/native-'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const gnu = join(repository, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src');
const environment = locale => locale === null ? {} : { LC_ALL: locale, LANG: locale };
const execute = (path, args, input, cwd, env) => {
  const result = spawnSync(path, args, { cwd, env, input, timeout: 3000, maxBuffer: 2 * 1024 * 1024 });
  return { argv: [path, ...args], env, status: result.status, signal: result.signal,
    stdout: (result.stdout ?? Buffer.alloc(0)).toString('base64'), stderr: (result.stderr ?? Buffer.alloc(0)).toString('base64'),
    error: result.error ? { name: result.error.name, message: result.error.message, code: result.error.code } : null };
};
const snapshot = cwd => {
  const entries = [];
  const walk = relative => {
    for (const name of readdirSync(join(cwd, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      const stat = lstatSync(join(cwd, path));
      if (stat.isDirectory()) { entries.push({ path, type: 'directory' }); walk(path); }
      else if (stat.isSymbolicLink()) entries.push({ path, type: 'symlink', target: readlinkSync(join(cwd, path)) });
      else entries.push({ path, type: 'file', bytes: readFileSync(join(cwd, path)).toString('base64') });
    }
  };
  walk('');
  return entries;
};
const setup = (cwd, files) => {
  for (const entry of files) {
    mkdirSync(dirname(join(cwd, entry.path)), { recursive: true });
    if (entry.type === 'directory') mkdirSync(join(cwd, entry.path));
    else if (entry.type === 'symlink') symlinkSync(entry.target, join(cwd, entry.path));
    else if (entry.type === 'hardlink') linkSync(join(cwd, entry.target), join(cwd, entry.path));
    else writeFileSync(join(cwd, entry.path), Buffer.from(entry.bytes, 'base64'));
  }
};
const metadata = { capturedAt: new Date().toISOString(), productExecuted: false, authorSourceExposed: false,
  platform: process.platform, arch: process.arch, node: process.version, nodeSha256: sha256(readFileSync(process.execPath)),
  host: execute('/usr/bin/uname', ['-a'], '', scratch, {}), os: execute('/usr/bin/sw_vers', [], '', scratch, {}),
  localeAvailability: execute('/usr/bin/locale', ['-a'], '', scratch, {}),
  release: readFileSync(gate, 'utf8'), corpusSha256: sha256(readFileSync(join(owned, 'corpus.mjs'))),
  captureSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  references: [], contractPlan,
  primaryDocs: ['https://www.gnu.org/software/coreutils/manual/html_node/seq-invocation.html', 'https://www.gnu.org/software/coreutils/manual/html_node/nl-invocation.html', 'https://www.gnu.org/software/coreutils/manual/html_node/unexpand-invocation.html', 'https://www.gnu.org/software/coreutils/manual/html_node/split-invocation.html', 'https://github.com/apple-oss-distributions/text_cmds/blob/main/rev/rev.c', 'https://github.com/util-linux/util-linux/blob/master/text-utils/rev.c'],
  installedManualSha256: sha256(readFileSync(join(gnu, '../doc/coreutils.texi'))),
  apiInspection: 'Existing public/contracts/ByteIO/Shell/Memory+Real interfaces/old stream index+README read-only 2026-08-27T05:42Z–05:43Z. Author API proposals only; no author unpublished source/tests. Earlier coordination 05:44/05:45 labels were anticipatory timestamp mistakes, not elapsed work.',
  limitations: ['GNU coreutils 9.7 built on Darwin, not GNU/Linux runtime evidence.', 'rev reference Apple only; no installed util-linux rev evidence.', 'Online rolling manuals consulted, installed 9.7 manual hash and actual runtime determine captured profiles.', 'No product or prep pass claimed; fixture setup and native harness are not virtual command effects.'] };
const profiles = ['gnu-darwin', 'apple'];
const executable = (profile, command) => join(profile === 'gnu-darwin' && command !== 'rev' ? gnu : '/usr/bin', command);
for (const profile of profiles) for (const command of ['seq', 'nl', 'rev', 'unexpand', 'split', 'expand']) {
  if (profile === 'gnu-darwin' && command === 'rev') continue;
  const path = executable(profile, command);
  metadata.references.push({ profile, command, path, sha256: sha256(readFileSync(path)),
    version: profile === 'gnu-darwin' ? execute(path, ['--version'], '', scratch, environment('C')) : null });
}
const records = [];
for (const fixture of corpus) for (const profile of profiles) {
  if (fixture.command === 'rev' && profile === 'gnu-darwin') continue;
  const cwd = mkdtempSync(join(scratch, `${fixture.id}-${profile}-`));
  setup(cwd, fixture.files);
  const before = snapshot(cwd);
  const result = execute(executable(profile, fixture.command), fixture.args, Buffer.from(fixture.stdin, 'base64'), cwd, environment(fixture.locale));
  records.push({ id: fixture.id, profile, fixture, cwd, before, ...result, after: snapshot(cwd) });
}
const workflowRecords = [];
for (const fixture of workflows) {
  const cwd = mkdtempSync(join(scratch, `${fixture.id}-`));
  let input = Buffer.from(fixture.stdin, 'base64');
  const stages = [];
  for (const [command, ...args] of fixture.stages) {
    const result = execute(executable('gnu-darwin', command), args, input, cwd, environment(fixture.locale));
    stages.push(result);
    input = Buffer.from(result.stdout, 'base64');
    if (result.status !== 0 || result.error) break;
  }
  workflowRecords.push({ id: fixture.id, profile: 'GNU-coreutils-on-Darwin-plus-Apple-rev', fixture, cwd, stages, after: snapshot(cwd) });
}
const document = `${JSON.stringify({ metadata, records, workflows: workflowRecords }, null, 2)}\n`;
writeFileSync(join(scratch, 'native.json'), document);
const publish = `*** Begin Patch\n*** Add File: ${join(owned, 'frozen/native.json')}\n${document.split('\n').filter((line, index, lines) => index !== lines.length - 1).map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
writeFileSync(join(scratch, 'publish.patch'), publish);
console.log(JSON.stringify({ scratch, publicationPatch: join(scratch, 'publish.patch'), sha256: sha256(document), cases: corpus.length, nativeControls: records.length, workflows: workflowRecords.length, runtimeFaults: records.filter(record => record.error).map(record => ({ id: record.id, profile: record.profile, error: record.error })) }, null, 2));
