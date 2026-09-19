// Explicit native oracle entrypoint. Never export/import from the product engine.
import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { validateRequest, qualifyProfile } from './model.js';
import { collectProcess } from './process.js';
import { snapshot } from './snapshot.js';

interface Binding {
  profileId: string;
  interpreter: { path: string; sha256: string };
  sourceArchive: { path: string; sha256: string };
  executables: Record<string, { path: string; sha256: string }>;
}

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const out = path.join(repository, 'out');
const [bindingPath, requestPath, workDirectory, outputPath] = process.argv.slice(2);
if (!bindingPath || !requestPath || !workDirectory || !outputPath || process.argv.length !== 6) throw new Error('usage: capture.ts BINDING.json REQUEST.json EXISTING_OUT_CASE_DIR NEW_OUT_CAPTURE.json');

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (target: string) => {
  if (!target.endsWith('.json') || !path.isAbsolute(target)) throw new Error('explicit absolute JSON path required');
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_000_000) throw new Error('JSON input must be a bounded nonlink regular file');
  const bytes = await fs.readFile(target);
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
};
const verifyArtifact = async (entry: { path: string; sha256: string }) => {
  if (!entry || !path.isAbsolute(entry.path) || await fs.realpath(entry.path) !== entry.path) throw new Error('artifact path must be explicit canonical nonlink path');
  const stat = await fs.lstat(entry.path);
  if (!stat.isFile() || stat.size > 128_000_000) throw new Error('artifact must be a bounded regular file');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(entry.path)) digest.update(chunk);
  const actual = digest.digest('hex');
  if (actual !== entry.sha256) throw new Error(`artifact hash mismatch: ${entry.path}`);
  return { ...entry, size: stat.size };
};
const admittedOut = async (target: string, existing: boolean) => {
  if (!path.isAbsolute(target) || target !== path.resolve(target) || !target.startsWith(out + path.sep)) throw new Error('native working/output paths must be canonical descendants of repository out');
  const ancestor = existing ? target : path.dirname(target);
  if (await fs.realpath(ancestor) !== ancestor) throw new Error('native out ancestor must be nonlink');
};
await admittedOut(workDirectory, true);
await admittedOut(outputPath, false);
if (outputPath.startsWith(workDirectory + path.sep)) throw new Error('capture output must be outside observed work directory');

const bindingInput = await readJson(bindingPath);
const binding = bindingInput.value as Binding;
const requestInput = await readJson(requestPath);
const referenceInput = await readJson(path.join(repository, 'docs/csvkit/reference-profile.json'));
const frozen = referenceInput.value.profiles.find((entry: { id: string }) => entry.id === binding.profileId);
if (!frozen) throw new Error('unknown frozen reference profile');
validateRequest(requestInput.value, Object.keys(frozen.entryPoints));
const request = requestInput.value;
const qualificationInput = await readJson(path.join(repository, 'docs/csvkit/reference-requalification-20260917.json'));
const requalified = qualificationInput.value.profiles.find((entry: { id: string }) => entry.id === binding.profileId);
if (!requalified) throw new Error('missing frozen locale/stdio profile');
if (!isDeepStrictEqual(request.env, qualificationInput.value.environment)) throw new Error('request environment differs from frozen requalification profile');
if (binding.interpreter.sha256 !== frozen.runtime.executableSha256 || binding.sourceArchive.sha256 !== referenceInput.value.source.sha256) throw new Error('binding differs from pinned interpreter/source archive');
const interpreter = await verifyArtifact(binding.interpreter);
const archive = await verifyArtifact(binding.sourceArchive);
const executableBinding = binding.executables[request.command];
if (!executableBinding || path.basename(executableBinding.path) !== request.command) throw new Error('original executable binding is required');
const executable = await verifyArtifact(executableBinding);
const frozenScript = requalified.distributions.find((entry: { name: string }) => entry.name === 'csvkit')?.files.find((entry: { path: string }) => path.posix.basename(entry.path) === request.command);
if (!frozenScript) throw new Error('frozen csvkit script hash is unavailable');

const launch = (program: string, argv: string[], input: Uint8Array, timeout: number) => {
  const child = spawn(program, argv, { cwd: workDirectory, env: request.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  const completion = new Promise<{ status: number | null; signal: string | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal }));
  });
  return collectProcess({ stdout: child.stdout, stderr: child.stderr, completion,
    writeInput(bytes) { return new Promise<void>((resolve, reject) => { child.stdin.once('error', reject); child.stdin.end(bytes, resolve); }); },
    kill() { child.kill('SIGKILL'); }
  }, input, timeout, 64_000_000);
};

const probePath = fileURLToPath(new URL('./probe.py', import.meta.url));
const probeBytes = await fs.readFile(probePath);
const probe = await launch(interpreter.path, [probePath], new Uint8Array(), 60_000);
if (probe.status !== 0 || probe.timedOut || probe.outputLimitExceeded) throw new Error(`reference inspection blocked: status ${probe.status}`);
const inventory = JSON.parse(Buffer.from(probe.stdoutBase64, 'base64').toString('utf8'));
const qualification = qualifyProfile({ ...frozen, locale: requalified.locale, stdio: requalified.stdio, executable: { name: request.command, sha256: frozenScript.sha256 } }, { ...inventory, executable: { name: request.command, sha256: executable.sha256 } });
const toolingSources = await Promise.all(['capture.ts', 'model.ts', 'process.ts', 'snapshot.ts', 'probe.py'].map(async name => ({ path: `packages/csvkit/tools/reference/${name}`, sha256: sha(await fs.readFile(new URL(name, import.meta.url))) })));
const sourceManifest = await readJson(path.join(repository, 'docs/csvkit/source-manifest.json'));
const before = await snapshot(workDirectory, fs, 64_000_000);
const started = performance.now();
// A mismatched profile is recorded but never used to create a qualified capture.
const observed = qualification.qualified ? await launch(executable.path, request.argv, Buffer.from(request.stdinBase64, 'base64'), request.timeoutMs) : undefined;
const after = await snapshot(workDirectory, fs, 64_000_000);
const evidence = {
  schemaVersion: 1, role: 'isolated native csvkit reference', request,
  cwd: workDirectory, profileId: binding.profileId, profileQualified: qualification.qualified,
  profileQualificationScope: 'interpreter binary/version/platform, installed distribution manifests, locale and pipe stream metadata; native linkage and optional drivers require separate qualification',
  profileFailures: qualification.failures,
  hashes: { binding: sha(bindingInput.bytes), input: sha(requestInput.bytes), stdin: sha(Buffer.from(request.stdinBase64, 'base64')), referenceProfile: sha(referenceInput.bytes), requalification: sha(qualificationInput.bytes), sourceManifest: sha(sourceManifest.bytes), probeSource: sha(probeBytes) },
  toolingSources,
  artifacts: { interpreter, archive, executable }, inventory, inspection: probe,
  ...(observed ?? { stdoutBase64: '', stderrBase64: '', status: null, signal: null, timedOut: false, outputLimitExceeded: false }),
  filesBefore: before, filesAfter: after,
  database: { qualification: 'unmeasured', explanation: 'No qualified native transaction/result observer; DB bytes are not structured DB semantics.' },
  interactive: { qualification: 'unmeasured', explanation: 'Pipe-only profile; PTY/IPython capabilities are not qualified.' },
  timing: { elapsedMs: performance.now() - started, qualification: 'observation only; no controlled performance comparison' },
  signalBuffering: { qualification: 'unmeasured', explanation: 'Captured termination signal is not evidence of product signal/buffering equivalence.' },
  fullSupport: false
};
await fs.writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ outputPath, profileQualified: qualification.qualified, status: evidence.status }));
if (!qualification.qualified || evidence.timedOut || evidence.outputLimitExceeded) process.exitCode = 78;
