import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { admissionBarrier } from './predicates.mjs';
import { errorRecord, requireThat, relativeName } from './core.mjs';

export async function observe({ library, engine, specimen, bindings, signal, emit }) {
  requireThat(['virtual-bash', 'just-bash'].includes(engine), 'ENGINE', engine);
  const ours = engine === 'virtual-bash';
  const legacy = !specimen.id.startsWith('W');
  const env = legacy ? { ...bindings.legacyProfile.environment, ...specimen.env } : specimen.env;
  const report = { engine: ours ? 'ours' : 'baseline', caseId: specimen.id, captureErrors: [], events: [], additionalObservations: {}, cleanup: null };
  const mark = async event => { report.events.push(event); await emit({ kind: 'phase', event }); };
  let shell;
  let filesystem;
  async function snapshot() {
    const result = { complete: true, entries: [], bytes: 0 };
    const cap = legacy ? 33554432 : 65536;
    const visit = async (filename, depth) => {
      requireThat(depth <= 32 && result.entries.length < (legacy ? 4096 : 64), 'CENSUS_LIMIT', filename);
      const stat = await filesystem.lstat(filename);
      const type = ours ? stat.type : stat.isSymbolicLink ? 'symlink' : stat.isDirectory ? 'directory' : stat.isFile ? 'file' : 'unknown';
      const entry = { path: filename, type, mode: stat.mode, size: stat.size };
      result.entries.push(entry);
      if (type === 'file') {
        requireThat(Number.isSafeInteger(stat.size) && stat.size >= 0 && result.bytes + stat.size <= cap, 'CENSUS_LIMIT', filename);
        const bytes = ours ? await filesystem.readFile(filename, { signal, maxBytes: cap - result.bytes }) : await filesystem.readFileBuffer(filename);
        result.bytes += bytes.length;
        requireThat(result.bytes <= cap, 'CENSUS_LIMIT', filename);
        entry.base64 = Buffer.from(bytes).toString('base64');
      } else if (type === 'symlink') entry.target = await filesystem.readlink(filename);
      else if (type === 'directory') {
        const entries = await filesystem.readdir(filename);
        const names = entries.map(child => typeof child === 'string' ? child : child.name).sort();
        requireThat(new Set(names).size === names.length, 'CENSUS_DUPLICATE', filename);
        for (const name of names) { relativeName(name); await visit(path.posix.join(filename, name), depth + 1); }
      } else requireThat(false, 'CENSUS_TYPE', filename);
    };
    await visit('/', 0);
    return result;
  }
  try {
    requireThat(!specimen.inputChunkLengths, 'UNQUALIFIED_CHUNK_ADMISSION', 'W03 chunk boundaries are not represented by the historical scalar baseline stdin adapter; no silent rewrite.');
    await mark('constructor');
    if (ours) {
      filesystem = library.createMemoryFileSystem();
      const limits = legacy ? bindings.legacyProfile.target.limits : { maxOutputBytes: 65536, maxCommands: 32, maxLoopIterations: 16, maxSubstitutionDepth: 4, maxSourceBytes: 8192, maxExpansionFields: 256, maxExpansionBytes: 65536, pipeHighWaterMark: 1024 };
      shell = new library.Shell({ fs: filesystem, cwd: specimen.cwd, env, limits });
      shell.use(library.agentCommands());
      await admissionBarrier(shell, bindings.target.defaultNames, event => report.events.push(event));
    } else {
      filesystem = new library.InMemoryFs();
      const configuration = legacy ? bindings.legacyProfile.comparator : { executionLimitProfile: 'normal', executionLimits: { maxExecutionTimeMs: 30000, maxOutputSize: 65536, maxInputBytes: 65536, maxCommandCount: 32, maxLoopIterations: 16 } };
      shell = new library.Bash({ ...configuration, fs: filesystem, cwd: specimen.cwd, env });
    }
    await mark('fixture-setup');
    for (const directory of ['/fixture', '/tmp', '/home/user', ...specimen.directories.map(name => `/fixture/${relativeName(name)}`)]) await filesystem.mkdir(directory, { recursive: true });
    for (const [name, file] of Object.entries(specimen.files)) {
      const filename = `/fixture/${relativeName(name)}`;
      await filesystem.mkdir(path.posix.dirname(filename), { recursive: true });
      await filesystem.writeFile(filename, Buffer.from(file.base64, 'base64'));
      if (file.mode !== undefined) await filesystem.chmod(filename, file.mode);
    }
    for (const [name, target] of Object.entries(specimen.symlinks)) await filesystem.symlink(target, `/fixture/${relativeName(name)}`);
    report.before = await snapshot();
    await mark('exec-start');
    let started;
    if (specimen.expected.elapsedAtLeastMs !== undefined) started = performance.now();
    try {
      const bytes = Buffer.from(specimen.stdinBase64, 'base64');
      const result = await shell.exec(specimen.effectiveScript ?? specimen.script, ours
        ? { cwd: specimen.cwd, env, stdin: bytes, signal }
        : { cwd: specimen.cwd, env, replaceEnv: true, rawScript: true, stdin: bytes.toString('latin1'), stdinKind: 'bytes', signal });
      report.result = {
        exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
        stdoutBase64: Buffer.from(ours ? result.stdoutBytes : library.stdoutAsBytes(result), 'latin1').toString('base64'),
        stderrBase64: Buffer.from(ours ? result.stderrBytes : result.stderr, 'utf8').toString('base64'),
        stdoutBoundary: ours ? 'raw ShellResult.stdoutBytes' : 'stdoutAsBytes ByteString encoded Latin-1',
        stderrBoundary: ours ? 'raw ShellResult.stderrBytes' : 'derived UTF-8 public stderr string',
      };
    } catch (error) { report.executionError = errorRecord(error); }
    finally { if (started !== undefined) report.productElapsedMs = performance.now() - started; await mark('exec-settled'); }
    report.after = await snapshot();
    await mark('snapshot-complete');
  } catch (error) { report.error = errorRecord(error); report.captureErrors.push({ error: report.error }); }
  finally {
    await mark('dispose-start');
    try {
      if (ours && shell) await shell.dispose();
      report.cleanup = { completion: 'returned', disposed: ours && Boolean(shell), baselineDisposeAPI: false };
    } catch (error) { report.cleanup = { error: errorRecord(error) }; }
    await mark('dispose-settled');
  }
  return report;
}
