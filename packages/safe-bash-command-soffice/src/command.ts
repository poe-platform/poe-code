import { commandRuntimeIdentity, getCommandArguments, type CommandContext, type CommandDefinition } from 'safe-bash-contracts/command';
import { writeBytes } from 'safe-bash-contracts/io';
import { createOutputOperation, type OutputOperation } from 'safe-bash-contracts/output';
import type { VirtualShellPlugin } from 'safe-bash-contracts/plugin';
import { shellValueByteLength } from 'safe-bash-contracts/value';
import { parseSofficeArguments, parseSofficeByteArguments } from './arguments.js';
import { createSofficeBudget, type SofficeBudget } from './budget.js';
import { SofficeError, type ConversionParameters, type SofficeLimits } from './contracts.js';

export interface SofficeCommandOptions {
  readonly limits?: Partial<SofficeLimits>;
  readonly replace?: boolean;
}
/** Literal SDK operands; all modes share the CLI event parser and admission gates. */
export interface SofficeRunOptions extends SofficeCommandOptions {
  /** Exact ordered event-mode arguments, mutually exclusive with structured options. */
  readonly args?: readonly string[];
  readonly files?: readonly string[];
  readonly conversion?: ConversionParameters;
  readonly outdir?: string;
  readonly importFilters?: readonly { readonly name: string; readonly options: string }[];
  readonly headless?: boolean;
  readonly help?: boolean;
  readonly version?: boolean;
  readonly textCat?: boolean;
  readonly scriptCat?: boolean;
}
export interface SofficeResult {
  readonly exitCode: 0 | 1;
  readonly status: 'help' | 'version' | 'invalid-argument' | 'unsupported' | 'limit';
}
const defaultLimits: SofficeLimits = Object.freeze({
  argumentBytes: 65_536, files: 1024, inputBytes: 16_777_216, retainedBytes: 1_048_576,
  outputBytes: 65_536, nodes: 100_000, pages: 1000, work: 1_000_000
});
const sourceRevision = 'd17755172ac96e54e3f10f35dd1b1680f0ef84bd';
const help = 'Usage: soffice [OPTIONS] [--] [FILE ...]\n'
  + 'Options: --help, --version, --headless, --cat, --script-cat\n'
  + '  --convert-to extension[:filter[:options]]\n'
  + '  --outdir VFS_PATH\n'
  + '  --infilter=name:options\n'
  + 'A FILE of - denotes stdin; other operands are literal VFS paths.\n'
  + 'Office conversion is not qualified.\n'
  + 'UI, printing, profiles, listeners and macro execution are denied.\n';

function sdkArguments(options: SofficeRunOptions, budget: SofficeBudget): string[] {
  const args: string[] = [];
  let minimumBytes = 0;
  const append = (text: string): void => {
    minimumBytes += text.length;
    // No encoding or concatenation is needed to reject impossible text extents.
    if (minimumBytes > (options.limits?.argumentBytes ?? defaultLimits.argumentBytes)) throw new SofficeError('limit', 'resource exhausted', 'argumentBytes');
    budget.charge('retainedBytes', 2 * text.length + 16);
    budget.charge('work', text.length + 1);
    args.push(text);
  };
  if (options.args !== undefined) {
    for (const key of ['files', 'conversion', 'outdir', 'importFilters', 'headless', 'help', 'version', 'textCat', 'scriptCat'] as const) {
      if (options[key] !== undefined) throw new SofficeError('invalid-argument', 'ordered args cannot be combined with structured options');
    }
    for (const text of options.args) append(text);
    return args;
  }
  if (options.headless) append('--headless');
  if (options.help) append('--help');
  if (options.version) append('--version');
  if (options.conversion) {
    const { extension, filter, options: filterOptions } = options.conversion;
    for (const text of [extension, filter, filterOptions]) {
      budget.charge('work', text.length);
      budget.charge('retainedBytes', text.length * 2);
    }
    // Delimiters in structured names cannot be represented by the CLI grammar.
    if (extension.includes(':') || filter.includes(':')) throw new SofficeError('invalid-argument', 'colon in structured filter name');
    append('--convert-to'); append(extension + ':' + filter + ':' + filterOptions);
  }
  if (options.textCat) append('--cat');
  if (options.scriptCat) append('--script-cat');
  if (options.outdir !== undefined) { append('--outdir'); append(options.outdir); }
  for (const filter of options.importFilters ?? []) {
    budget.charge('retainedBytes', (filter.name.length + filter.options.length) * 2);
    budget.charge('work', filter.name.length + filter.options.length);
    if (!filter.name || filter.name.includes(':')) throw new SofficeError('invalid-argument', 'invalid structured import filter name');
    append('--infilter=' + filter.name + ':' + filter.options);
  }
  append('--');
  for (const file of options.files ?? []) append(file);
  return args;
}

async function executeSoffice(context: CommandContext, configuration: SofficeCommandOptions, sdk?: SofficeRunOptions): Promise<SofficeResult> {
  const controller = new AbortController(), signal = controller.signal;
  let budget: SofficeBudget | undefined, stdout: OutputOperation | undefined, stderr: OutputOperation | undefined;
  let closing: Promise<void> | undefined;
  const abort = (): void => controller.abort(context.signal.reason);
  const cleanup = (): Promise<void> => {
    if (closing) return closing;
    closing = Promise.resolve().then(async () => {
      await Promise.allSettled([task]);
      context.signal.removeEventListener('abort', abort);
      try {
        const results = await Promise.allSettled([stdout?.close(), stderr?.close()]);
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, 'Soffice output cleanup failed');
      } finally { budget?.close(); }
    });
    controller.abort(new SofficeError('closed', 'invocation closed'));
    return closing;
  };
  context.registerCleanup?.(cleanup);
  context.signal.addEventListener('abort', abort, { once: true });
  if (context.signal.aborted) abort();
  const task = (async (): Promise<SofficeResult> => {
    signal.throwIfAborted();
    const output = async (destination: OutputOperation, text: string): Promise<void> => {
      budget!.charge('work', text.length);
      const extent = 3 * text.length;
      budget!.charge('retainedBytes', extent);
      try {
        const storage = new Uint8Array(extent);
        const { written } = new TextEncoder().encodeInto(text, storage);
        budget!.charge('outputBytes', written);
        await writeBytes(destination.output, storage.subarray(0, written), signal);
      } finally { budget!.releaseRetainedBytes(extent); }
    };
    try {
      budget = createSofficeBudget({ ...defaultLimits, ...configuration.limits }, signal);
      stdout = createOutputOperation({ signal }, context.stdout);
      stderr = createOutputOperation({ signal }, context.stderr);
      let request;
      if (sdk) {
        const args = sdkArguments(sdk, budget);
        request = parseSofficeArguments(args, budget);
      } else {
        if (!context.argumentValues) budget.charge('retainedBytes', 128 + 40 * context.args.length);
        for (const arg of context.args) {
          budget.charge('work', 1);
          if (arg.length > (configuration.limits?.argumentBytes ?? defaultLimits.argumentBytes)) throw new SofficeError('limit', 'resource exhausted', 'argumentBytes');
          if (!context.argumentValues) budget.charge('retainedBytes', 2 * arg.length);
        }
        const carrier = getCommandArguments(context), bytes: Uint8Array[] = [];
        for (let index = 0; index < carrier.values.length; index++) {
          const value = carrier.values[index]!;
          if (typeof value === 'string') budget.charge('work', value.length);
          const extent = shellValueByteLength(value);
          budget.charge('work', extent + 1);
          budget.charge('retainedBytes', extent + 16);
          bytes.push(carrier.bytes(index)!);
        }
        request = parseSofficeByteArguments(bytes, budget);
      }
      for (const warning of request.warnings) await output(stderr, 'soffice: warning: ' + warning + '\n');
      if (request.help) { await output(stdout, help); return { exitCode: 0, status: 'help' }; }
      if (request.version) {
        await output(stdout, 'safe-bash soffice adapter v1\nLibreOffice source ' + sourceRevision + '\nnative conversion unqualified\n');
        return { exitCode: 0, status: 'version' };
      }
      throw new SofficeError('unsupported', 'Office conversion is not qualified');
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof SofficeError) || !['invalid-argument', 'unsupported', 'limit'].includes(error.code)) throw error;
      // A depleted budget cannot authorize further diagnostic output.
      if (error.code === 'limit') return { exitCode: 1, status: 'limit' };
      if (!stderr) throw error;
      try {
        await output(stderr, `soffice: ${error.code}: ${error.message}${error.detail ? ': ' + error.detail : ''}\n`);
      } catch (diagnosticError) {
        signal.throwIfAborted();
        if (!(diagnosticError instanceof SofficeError) || diagnosticError.code !== 'limit') throw diagnosticError;
        return { exitCode: 1, status: 'limit' };
      }
      return { exitCode: 1, status: error.code as 'invalid-argument' | 'unsupported' };
    }
  })();
  try { return await task; }
  finally { await cleanup(); context.signal.throwIfAborted(); }
}

export function soffice(context: CommandContext, options: SofficeRunOptions = {}): Promise<SofficeResult> {
  const invocation = Object.freeze({ ...options, limits: Object.freeze({ ...options.limits }) });
  return executeSoffice(context, invocation, invocation);
}
export function createSofficeCommand(options: SofficeCommandOptions = {}): CommandDefinition {
  const configuration = Object.freeze({ ...options, limits: Object.freeze({ ...options.limits }) });
  return Object.freeze({ name: 'soffice', runtimeIdentity: commandRuntimeIdentity,
    description: 'Admit Office arguments without host capabilities',
    execute(context: CommandContext) { return executeSoffice(context, configuration); } });
}
export const sofficeCommand = createSofficeCommand();
export function sofficeCommands(options: SofficeCommandOptions = {}): VirtualShellPlugin {
  const command = createSofficeCommand(options), replace = options.replace ?? false;
  return { name: 'soffice', setup(host) { host.commands.register(command, { replace }); } };
}
