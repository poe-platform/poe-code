import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { directory, loadInputs, regular, requireValue, hash } from './harness.mjs';
export async function runVirtual(config) {
  const { cases, protocol } = loadInputs();
  const row = cases.cases.find(item => item.id === config.id); requireValue(row, 'CASE_ID');
  requireValue(config.phase === 'semantics' && config.rootQualifiedExecution === true, 'NO_PRODUCT_GO');
  requireValue(path.isAbsolute(config.productRoot) && config.productRoot.startsWith(protocol.phases.semantics.root + '/'), 'PRODUCT_ROOT');
  const members = JSON.parse(fs.readFileSync(path.join(directory, 'PACKAGE-MEMBERS.json')));
  for (const member of members) regular(path.join(config.productRoot, member.path), member);
  const { Shell, agentCommands, createMemoryFileSystem } = await import(pathToFileURL(path.join(config.productRoot, 'dist/index.js')).href);
  const vfs = createMemoryFileSystem();
  for (const name of ['/work', '/home', '/tmp', '/empty-path']) await vfs.mkdir(name, { mode: 448 });
  for (const [name, text] of Object.entries(cases.fixtures)) await vfs.writeFile('/work/' + name, Buffer.from(text), { mode: 384 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(Error('SURFACE_CASE_DEADLINE')), protocol.phases.semantics.perCaseMs);
  const shell = new Shell({ fs: vfs, cwd: '/work', env: protocol.virtualEnvironment, limits: { maxOutputBytes: 524288, maxCommands: 256, maxLoopIterations: 128, maxSubstitutionDepth: 8, maxSourceBytes: 4096, maxExpansionFields: 4096, maxExpansionBytes: 1048576, pipeHighWaterMark: 4096 } }).use(agentCommands());
  let outcome; let cleanupError;
  const chunks = { stdout: [], stderr: [] }, sizes = { stdout: 0, stderr: 0 };
  const sink = name => ({ write: async bytes => { requireValue(sizes[name] + bytes.length <= 262144, 'SURFACE_OUTPUT_CAP'); const owned = Buffer.from(bytes); sizes[name] += owned.length; chunks[name].push(owned); } });
  try {
    const result = await shell.exec(row.program, { stdin: Buffer.from(row.stdin ?? cases.defaultStdin), stdout: sink('stdout'), stderr: sink('stderr'), signal: controller.signal });
    outcome = { id: row.id, kind: 'result', status: result.exitCode };
  } catch (error) { outcome = { id: row.id, kind: 'API-rejection', name: error?.name, message: String(error?.message ?? error) }; }
  finally { try { await shell.dispose(); } catch (error) { cleanupError = String(error); } clearTimeout(timer); }
  outcome.stdoutBase64 = Buffer.concat(chunks.stdout).toString('base64'); outcome.stderrBase64 = Buffer.concat(chunks.stderr).toString('base64');
  const files = []; let retained = 0;
  async function visit(absolute, relative) {
    const entries = await vfs.readdir(absolute);
    for (const entry of [...entries].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const filename = absolute + '/' + entry.name, rel = relative ? relative + '/' + entry.name : entry.name, stat = await vfs.lstat(filename);
      requireValue(files.length < 256, 'VFS_ENTRY_CAP');
      if (stat.type === 'directory') { files.push({ path: rel, type: 'directory', mode: stat.mode }); await visit(filename, rel); }
      else if (stat.type === 'symlink') files.push({ path: rel, type: 'symlink', target: await vfs.readlink(filename), mode: stat.mode });
      else { const bytes = await vfs.readFile(filename); retained += bytes.length; requireValue(retained <= 4194304, 'VFS_BYTE_CAP'); files.push({ path: rel, type: 'file', mode: stat.mode, base64: Buffer.from(bytes).toString('base64') }); }
    }
  }
  await visit('/', '');
  return { ...outcome, files, cleanupError: cleanupError ?? null, disposed: cleanupError === undefined, callerAborted: controller.signal.aborted, profile: 'immutable-c83f-full950-materialized-package-not-new-installed-proof' };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  requireValue(process.argv.length === 4 && process.argv[2] === '--config', 'EXACT_ARGUMENTS');
  const config = JSON.parse(fs.readFileSync(process.argv[3]));
  console.log(JSON.stringify(await runVirtual(config)));
}
