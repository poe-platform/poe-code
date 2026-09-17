import type { FileSystem } from '../../contracts/filesystem.js';

const messages = {
  'executor-unavailable': 'Python executor is unavailable; configure exactly one supported executor or interpreter worker.',
  'transport-unavailable': 'Python worker transport or shared-memory operations are unavailable.',
  'runtime-abi': 'Python runtime version or native ABI is unsupported.',
  'runtime-assets': 'Python runtime or package assets could not be loaded.',
  'filesystem-open': 'Python filesystem handle access is unavailable; the backend must support retained open.',
  'filesystem-read': 'Python filesystem reads are unavailable for this backend.',
  'filesystem-write': 'Python filesystem writes are unavailable for this backend.',
  'filesystem-directory': 'Python retained directory operations are unavailable for this backend.',
  'filesystem-operation': 'The requested Python filesystem operation is unavailable for this backend.',
  capacity: 'Python worker capacity exhausted.',
  cleanup: 'Python resource cleanup failed; retirement could not be confirmed.',
  startup: 'Python startup failed; consult the host diagnostic callback.',
  runtime: 'Python runtime failed; consult the host diagnostic callback.',
} as const;

export type PythonFailureCategory = keyof typeof messages;

export class PythonFailure extends Error {
  constructor(readonly category: PythonFailureCategory, options?: ErrorOptions) {
    super(messages[category], options);
    this.name = 'PythonFailure';
  }
}

export interface PythonDiagnostic {
  readonly failure: PythonFailure;
  readonly cause: unknown;
}

export type PythonDiagnosticObserver = (diagnostic: PythonDiagnostic) => void | Promise<void>;
export type PythonFileSystemRequirement = 'open' | 'read' | 'write' | 'directory';

export function isPythonFailureCategory(value: unknown): value is PythonFailureCategory {
  return typeof value === 'string' && Object.hasOwn(messages, value);
}

export function reportPythonFailure(category: PythonFailureCategory, cause: unknown, observer?: PythonDiagnosticObserver): PythonFailure {
  const failure = new PythonFailure(category);
  try { void Promise.resolve(observer?.({ failure, cause })).catch(() => {}); } catch {}
  return failure;
}

export interface PythonCapabilityOptions {
  readonly createWorker?: () => unknown;
  readonly createExecutor?: () => unknown;
  readonly fs?: FileSystem;
  readonly requiredFileSystem?: readonly PythonFileSystemRequirement[];
  readonly runtimeVersion?: string;
}

export interface PythonCapabilityReport {
  readonly configurationValid: boolean;
  readonly failures: readonly PythonFailure[];
}

export function inspectPythonCapabilities(options: PythonCapabilityOptions = {}): PythonCapabilityReport {
  const failures = new Set<PythonFailureCategory>();
  if ((typeof options.createWorker === 'function') === (typeof options.createExecutor === 'function')
    || options.createWorker !== undefined && typeof options.createWorker !== 'function'
    || options.createExecutor !== undefined && typeof options.createExecutor !== 'function') failures.add('executor-unavailable');
  if (typeof options.createExecutor !== 'function' && (typeof SharedArrayBuffer !== 'function' || typeof Atomics !== 'object'
    || typeof Atomics.store !== 'function' || typeof Atomics.notify !== 'function')) failures.add('transport-unavailable');
  if (options.runtimeVersion !== undefined && options.runtimeVersion !== '314.0.6') failures.add('runtime-abi');
  for (const requirement of options.requiredFileSystem ?? []) {
    if (!['open', 'read', 'write', 'directory'].includes(requirement)) throw new TypeError('Unknown Python filesystem requirement');
    const category: PythonFailureCategory = requirement === 'open' ? 'filesystem-open'
      : requirement === 'read' ? 'filesystem-read' : requirement === 'write' ? 'filesystem-write' : 'filesystem-directory';
    try {
      const fs = options.fs;
      if (requirement === 'directory') {
        failures.add(category);
      } else if (!fs || typeof fs.open !== 'function' || fs.capabilities.open === false) failures.add('filesystem-open');
      else if (requirement === 'write' && (fs.capabilities.readOnly === true || fs.capabilities.write === false)) failures.add(category);
      else if (requirement === 'read' && fs.capabilities.read === false) failures.add(category);
    } catch { failures.add(category); }
  }
  return Object.freeze({ configurationValid: failures.size === 0,
    failures: Object.freeze([...failures].map(category => new PythonFailure(category))) });
}
