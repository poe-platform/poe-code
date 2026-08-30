import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { publicAdmission } from '../executor-overlay-v2/admission.mjs';
import { settle } from './safety.mjs';
import { instrumentFilesystem, assessWhich } from '../executor-v3/w07.mjs';
import { census } from '../executor-overlay-v2/namespace.mjs';
import { byteInput, telemetryOutcome } from '../executor-overlay-v2/telemetry.mjs';
import { errorRecord, requireThat, relativeName } from '../executor-preparation-v1/core.mjs';

export async function observe({ library, engine, specimen, bindings, namespaces, signal, emit, authorization }) {
  requireThat(authorization?.rootGo === true && authorization?.differentFreeze && authorization?.candidate === '67eab12e315054907ef4ef435c6bbca2f59e0c36', 'ROOT_GO_REQUIRED', 'adapter-v2 is preparation only until rootGO');
  requireThat(['virtual-bash', 'just-bash'].includes(engine), 'ENGINE', engine);
  const ours = engine === 'virtual-bash';
  const legacy = !specimen.id.startsWith('W');
  const env = legacy ? { ...bindings.legacyProfile.environment, ...specimen.env } : specimen.env;
  const report = { engine: ours ? 'ours' : 'baseline', caseId: specimen.id, captureErrors: [], events: [], additionalObservations: {}, cleanup: null };
  let phaseEmitter;
  const mark = async event => { report.events.push(event); await phaseEmitter(event); };
  let shell;
  let filesystem;
  const dispatches = [];
  const filesystemEvents = [];
  let currentPhase = 'setup';
  let stdinAdmission;
  async function snapshot() {
    if (!legacy) return census(filesystem, engine, namespaces[engine], signal);
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
  const safety = await settle({
    emit: event => emit({ kind: 'phase', event }),
    dispose: async () => {
      if (ours && shell) await shell.dispose();
      report.cleanup = { completion: 'returned', disposed: ours && Boolean(shell), baselineDisposeAPI: false };
    },
    body: async phase => {
    phaseEmitter = phase;
    await mark('constructor');
    if (ours) {
      filesystem = instrumentFilesystem(library.createMemoryFileSystem(), filesystemEvents, () => currentPhase);
      const limits = legacy ? bindings.legacyProfile.target.limits : { maxOutputBytes: 65536, maxCommands: 32, maxLoopIterations: 16, maxSubstitutionDepth: 4, maxSourceBytes: 8192, maxExpansionFields: 256, maxExpansionBytes: 65536, pipeHighWaterMark: 1024 };
      shell = new library.Shell({ fs: filesystem, cwd: specimen.cwd, env, limits });
      shell.use(async (context, next) => {
        requireThat(dispatches.length < 256 && Buffer.byteLength(context.command) <= 1024, 'DISPATCH_TELEMETRY_CAP', context.command);
        dispatches.push({ command: context.command, phase: currentPhase });
        return next();
      });
      shell.use(library.agentCommands());

    } else {
      filesystem = instrumentFilesystem(new library.InMemoryFs(), filesystemEvents, () => currentPhase);
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
    if (ours) {
      const setupBefore = JSON.stringify(report.before);
      await publicAdmission(shell, bindings.target.defaultNames, event => report.events.push(event), signal);
      const setupAfter = await snapshot();
      requireThat(JSON.stringify(setupAfter) === setupBefore && dispatches.length === 0, 'SETUP_NONINTERFERENCE', { dispatches });
      report.setup = { execCalls: 1, emptySource: true, dispatches: dispatches.length, namespaceUnchanged: true, settled: true };
    } else report.setup = { execCalls: 0, settled: true };
    requireThat(Buffer.byteLength(JSON.stringify(report.before)) <= 131072, 'SNAPSHOT_TRANSPORT_CAP', 'before');
    await mark('exec-start');
    let started;
    if (specimen.expected.elapsedAtLeastMs !== undefined) started = performance.now();
    try {
      const input = byteInput(specimen, engine);
      stdinAdmission = input.receipt;
      currentPhase = 'semantic';
      const result = await shell.exec(specimen.effectiveScript ?? specimen.script, ours
        ? { cwd: specimen.cwd, env, stdin: input.stdin, signal, ...input.options }
        : { cwd: specimen.cwd, env, stdin: input.stdin, signal, ...input.options });
      report.result = {
        exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
        stdoutBase64: Buffer.from(ours ? result.stdoutBytes : library.stdoutAsBytes(result), 'latin1').toString('base64'),
        stderrBase64: Buffer.from(ours ? result.stderrBytes : result.stderr, 'utf8').toString('base64'),
        stdoutBoundary: ours ? 'raw ShellResult.stdoutBytes' : 'stdoutAsBytes ByteString encoded Latin-1',
        stderrBoundary: ours ? 'raw ShellResult.stderrBytes' : 'derived UTF-8 public stderr string',
      };
    } catch (error) { report.executionError = errorRecord(error); }
    finally { currentPhase = 'capture'; if (started !== undefined) report.productElapsedMs = performance.now() - started; await mark('exec-settled'); }
    report.after = await snapshot();
    requireThat(Buffer.byteLength(JSON.stringify(report.after)) <= 131072, 'SNAPSHOT_TRANSPORT_CAP', 'after');
    if (specimen.id === 'W07') {
      const which = assessWhich(filesystemEvents, dispatches, report.before, report.after, engine);
      report.additionalObservations = which.observations;
      report.whichTelemetry = which.receipt;
    }
    await mark('snapshot-complete');
    },
  });
  report.safety = { safe: safety.safe, disposed: safety.disposed, errors: safety.errors, hasPrimary: safety.hasPrimary };
  if (safety.errors.length) {
    report.error = errorRecord(safety.primary);
    report.captureErrors.push(...safety.errors);
  }
  if (!safety.disposed) report.cleanup = { error: safety.errors.find(row => row.phase === 'dispose')?.error ?? report.error };
  if (stdinAdmission) report.telemetry = telemetryOutcome(specimen, engine, stdinAdmission, dispatches, report.cleanup?.completion === 'returned');
  return report;
}
