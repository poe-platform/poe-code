import { isDeepStrictEqual } from 'node:util';

export interface CaptureRequest {
  id: string;
  command: string;
  argv: string[];
  stdinBase64: string;
  env: Record<string, string>;
  tty: false;
  timeoutMs: number;
}

export function validateRequest(value: unknown, names: readonly string[]): asserts value is CaptureRequest {
  if (!value || typeof value !== 'object') throw new TypeError('capture request must be an object');
  const request = value as Record<string, unknown>;
  if (typeof request.id !== 'string' || !request.id || typeof request.command !== 'string' || !names.includes(request.command)) throw new TypeError('unknown capture id/command');
  if (!Array.isArray(request.argv) || request.argv.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new TypeError('argv must be literal strings without NUL');
  if (typeof request.stdinBase64 !== 'string' || Buffer.from(request.stdinBase64, 'base64').toString('base64') !== request.stdinBase64) throw new TypeError('stdin must use canonical base64');
  if (!request.env || typeof request.env !== 'object' || Array.isArray(request.env)) throw new TypeError('exact explicit environment required');
  for (const [key, entry] of Object.entries(request.env)) {
    if (!key || key.includes('=') || key.includes('\0') || typeof entry !== 'string' || entry.includes('\0')) throw new TypeError('invalid environment entry');
  }
  if (request.tty !== false) throw new TypeError('TTY reference capture is blocked: no qualified PTY adapter');
  if (!Number.isSafeInteger(request.timeoutMs) || (request.timeoutMs as number) <= 0 || (request.timeoutMs as number) > 60_000) throw new TypeError('timeoutMs must be 1..60000');
}

interface Observation {
  profileId?: string;
  stdoutBase64: string;
  stderrBase64: string;
  status: number | null;
  signal: string | null;
  timedOut: boolean;
  outputLimitExceeded?: boolean;
  profileQualified?: boolean;
  captureComplete?: boolean;
  filesBefore: unknown;
  filesAfter: unknown;
  database: unknown;
  interactive: unknown;
}

export function compareCapture(reference: Observation, candidate: Observation) {
  const differences = (['profileId', 'stdoutBase64', 'stderrBase64', 'status', 'signal', 'filesBefore', 'filesAfter'] as const)
    .filter(key => !isDeepStrictEqual(reference[key], candidate[key]));
  const complete = [reference, candidate].every(capture =>
    typeof capture.profileId === 'string' && capture.profileId.length > 0 && capture.profileQualified === true &&
    [capture.stdoutBase64, capture.stderrBase64].every(value => typeof value === 'string' && Buffer.from(value, 'base64').toString('base64') === value) &&
    (capture.status === null || Number.isInteger(capture.status) && capture.status >= 0 && capture.status <= 255) &&
    (capture.signal === null || typeof capture.signal === 'string' && capture.signal.startsWith('SIG')) &&
    typeof capture.timedOut === 'boolean' && Array.isArray(capture.filesBefore) && Array.isArray(capture.filesAfter)
  );
  return {
    exact: complete && !reference.timedOut && !candidate.timedOut && !reference.outputLimitExceeded && !candidate.outputLimitExceeded && reference.captureComplete !== false && candidate.captureComplete !== false && (reference.status !== null || reference.signal !== null) && (candidate.status !== null || candidate.signal !== null) && differences.length === 0,
    differences,
    database: 'unmeasured', interactive: 'unmeasured', timings: 'unmeasured',
    fullSupport: false
  };
}

interface ProfileInventory {
  runtime: { executableSha256: string; version: string; implementation?: string; platform?: string };
  distributions: { name: string; version: string; installedFileManifestSha256: string }[];
  locale?: unknown;
  stdio?: unknown;
  executable?: { name: string; sha256: string };
}

export function qualifyProfile(expected: ProfileInventory, actual: ProfileInventory) {
  const failures: string[] = [];
  for (const key of ['version', 'executableSha256', 'implementation', 'platform'] as const) {
    if (expected.runtime[key] !== undefined && expected.runtime[key] !== actual.runtime[key]) failures.push(`runtime.${key}`);
  }
  for (const key of ['locale', 'stdio'] as const) if (expected[key] !== undefined && !isDeepStrictEqual(expected[key], actual[key])) failures.push(key);
  if (expected.executable !== undefined && !isDeepStrictEqual(expected.executable, actual.executable)) failures.push('executable');
  for (const distribution of expected.distributions) {
    const observed = actual.distributions.find(entry => entry.name === distribution.name);
    if (!observed || observed.version !== distribution.version || observed.installedFileManifestSha256 !== distribution.installedFileManifestSha256) failures.push(`distribution:${distribution.name}`);
  }
  return { qualified: failures.length === 0, failures };
}

type Entry = Record<string, unknown>;
interface Features {
  commands: (Entry & { name: string; actions: Entry[] })[];
  sourceBranches: Entry[];
  parserDeclarations?: Entry[];
}
interface Census {
  files: (Entry & { tests: Entry[]; staticTestAssignments?: Entry[] })[];
}

/** Preserve the complete historical census; attribution requires a separate exact case mapping. */
export function buildCoverage(features: Features, census: Census) {
  const unresolved = { status: 'unresolved', comparedCases: [], explanation: 'No authenticated case-to-source attribution supplied; existing scoped passes do not prove this declaration.' };
  const options = features.commands.flatMap(command => command.actions.map(action => ({ command: command.name, declaration: action, ...unresolved })));
  const branches = features.sourceBranches.map(branch => ({ declaration: branch, ...unresolved }));
  const parsers = (features.parserDeclarations ?? []).map(declaration => ({ declaration, ...unresolved }));
  const upstreamFiles = census.files.map(file => ({ ...file,
    tests: file.tests.map(declaration => ({ declaration, ...unresolved })),
    staticTestAssignments: (file.staticTestAssignments ?? []).map(declaration => ({ declaration, ...unresolved }))
  }));
  return {
    schemaVersion: 1, fullSupport: false, qualifiedPasses: 0,
    denominators: {
      commands: features.commands.length, options: options.length, branches: branches.length, parserDeclarations: parsers.length,
      upstreamFiles: upstreamFiles.length,
      testDeclarations: upstreamFiles.reduce((sum, file) => sum + file.tests.length, 0),
      staticAssignments: upstreamFiles.reduce((sum, file) => sum + file.staticTestAssignments.length, 0)
    },
    commands: features.commands, options, branches, parsers, upstreamFiles
  };
}
