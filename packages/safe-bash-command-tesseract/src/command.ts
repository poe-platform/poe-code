import { commandRuntimeIdentity, getCommandArguments, type CommandContext, type CommandDefinition } from 'safe-bash-contracts/command';
import { writeBytes } from 'safe-bash-contracts/io';
import { createOutputOperation, type OutputOperation } from 'safe-bash-contracts/output';
import type { VirtualShellPlugin } from 'safe-bash-contracts/plugin';
import { shellValueByteLength } from 'safe-bash-contracts/value';
import { parseTesseractArguments, type TesseractArguments } from './arguments.js';
import { TesseractError } from './contracts.js';

export interface TesseractCommandOptions {
  readonly maxArgumentBytes?: number;
  readonly maxOutputBytes?: number;
  readonly replace?: boolean;
}
/** Literal VFS operands; defaults match the command profile (PSM 3, OEM 3). */
export interface TesseractRunOptions extends TesseractCommandOptions {
  readonly action?: TesseractArguments['action'];
  readonly input?: string;
  readonly outputbase?: string;
  readonly language?: string;
  readonly psm?: number;
  readonly oem?: number;
  readonly dpi?: number;
  readonly tessdataDirectory?: string;
  readonly variables?: TesseractArguments['variables'];
  readonly configs?: readonly string[];
}
export interface TesseractResult {
  readonly exitCode: 0 | 1 | 2;
  readonly recognitionQualified: false;
  readonly outputBytes: number;
}

async function executeTesseract(context: CommandContext, configuration: TesseractCommandOptions, sdk?: TesseractRunOptions): Promise<TesseractResult> {
  const controller = new AbortController();
  const signal = controller.signal;
  const abort = (): void => controller.abort(context.signal.reason);
  let stdout: OutputOperation | undefined, stderr: OutputOperation | undefined;
  let task: Promise<TesseractResult | undefined> = Promise.resolve(undefined);
  let closing: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    if (closing) return closing;
    // Publish before aborting: listeners can synchronously reenter cleanup.
    closing = Promise.resolve().then(async () => {
      await Promise.allSettled([task]);
      context.signal.removeEventListener('abort', abort);
      const results = await Promise.allSettled([stdout?.close(), stderr?.close()]);
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'Tesseract output cleanup failed');
    });
    controller.abort(new TesseractError('closed', 'invocation closed'));
    return closing;
  };
  context.registerCleanup?.(cleanup);
  task = Promise.resolve().then(async () => {
    context.signal.addEventListener('abort', abort, { once: true });
    if (context.signal.aborted) abort();
    signal.throwIfAborted();
    const maxArgumentBytes = configuration.maxArgumentBytes ?? 65536;
    const maxOutputBytes = configuration.maxOutputBytes ?? 65536;
    for (const value of [maxArgumentBytes, maxOutputBytes]) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 1_048_576) throw new TesseractError('limit', 'invalid invocation limit');
    }
    const scope = { signal };
    stdout = createOutputOperation(scope, context.stdout);
    stderr = createOutputOperation(scope, context.stderr);
    let outputBytes = 0;
    const output = async (operation: OutputOperation, message: string): Promise<void> => {
      signal.throwIfAborted();
      const size = shellValueByteLength(message);
      if (size > maxOutputBytes - outputBytes) throw new TesseractError('limit', 'exhausted outputBytes', 'outputBytes');
      outputBytes += size;
      await writeBytes(operation.output, new TextEncoder().encode(message), signal);
    };
    let parsed: TesseractArguments;
    try {
      if (sdk) {
        const args: string[] = [];
        let extent = 0;
        const append = (value: string): void => {
          signal.throwIfAborted();
          if (value.length + 1 > maxArgumentBytes - extent) throw new TesseractError('limit', 'exhausted argumentBytes');
          extent += shellValueByteLength(value) + 1;
          if (extent > maxArgumentBytes) throw new TesseractError('limit', 'exhausted argumentBytes');
          args.push(value);
        };
        if (sdk.action && sdk.action !== 'recognize') append('--' + sdk.action);
        for (const [flag, value] of [['-l', sdk.language], ['--psm', sdk.psm], ['--oem', sdk.oem], ['--dpi', sdk.dpi], ['--tessdata-dir', sdk.tessdataDirectory]] as const) {
          if (value !== undefined) { append(flag); append(String(value)); }
        }
        for (const variable of sdk.variables ?? []) {
          if (variable.name.includes('=') || variable.name.length + variable.value.length + 2 > maxArgumentBytes - extent) throw new TesseractError('invalid-argument', 'invalid variable assignment');
          append('-c'); append(variable.name + '=' + variable.value);
        }
        // Leave an empty SDK invocation empty so the shared parser selects help.
        // Any supplied recognition option still requires input and outputbase.
        if (args.length || sdk.action === 'recognize' || sdk.input !== undefined || sdk.outputbase !== undefined || sdk.configs?.length) append('--');
        if (sdk.input !== undefined) append(sdk.input);
        if (sdk.outputbase !== undefined) append(sdk.outputbase);
        for (const config of sdk.configs ?? []) append(config);
        parsed = parseTesseractArguments(args, { maxArgumentBytes });
      } else {
        // Bound decoded operands before asking the canonical carrier for copies.
        parsed = parseTesseractArguments(context.args, { maxArgumentBytes });
        const carrier = getCommandArguments(context);
        let extent = 0;
        for (let index = 0; index < carrier.values.length; index++) {
          signal.throwIfAborted();
          extent += shellValueByteLength(carrier.values[index]!) + 1;
          if (extent > maxArgumentBytes) throw new TesseractError('limit', 'exhausted argumentBytes');
          try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(carrier.bytes(index)!); }
          catch { throw new TesseractError('invalid-argument', 'only UTF-8 VFS arguments are available'); }
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof TesseractError)) throw error;
      await output(stderr, 'tesseract: ' + error.message + '\n');
      return { exitCode: 1, recognitionQualified: false, outputBytes };
    }
    let exitCode: TesseractResult['exitCode'] = 0;
    if (parsed.action === 'help') await output(stdout, 'Usage: tesseract image outputbase [options] [configs]\nVFS byte-stream profile; qualified recognition engine is unavailable.\nOptions: -l language, --psm mode, --oem mode, --dpi 1..2400,\n         --tessdata-dir path, -c name=value, --list-langs, --version, --\n');
    else if (parsed.action === 'version') await output(stdout, 'tesseract safe-bash command profile\nSource: 8ae68101439b3f7df123499a784e8896c805179d\nRecognition: unavailable\n');
    else if (parsed.action === 'list-langs') await output(stderr, 'tesseract: qualified model loader is unavailable; no languages admitted\n');
    else {
      await output(stderr, 'tesseract: qualified recognition engine is unavailable\n');
      exitCode = 1;
    }
    return { exitCode, recognitionQualified: false, outputBytes };
  });
  try { return (await task)!; }
  finally { await cleanup(); context.signal.throwIfAborted(); }
}

export function tesseract(context: CommandContext, options: TesseractRunOptions): Promise<TesseractResult> {
  const invocation = { ...options };
  return executeTesseract(context, options, invocation);
}
export function createTesseractCommand(options: TesseractCommandOptions = {}): CommandDefinition {
  const configuration = Object.freeze({ ...options });
  return Object.freeze({ name: 'tesseract', runtimeIdentity: commandRuntimeIdentity,
    description: 'Explicit VFS OCR admission profile (recognition unavailable)',
    execute(context: CommandContext) { return executeTesseract(context, configuration); } });
}
export const tesseractCommand = createTesseractCommand();
export function tesseractCommands(options: TesseractCommandOptions = {}): VirtualShellPlugin {
  const command = createTesseractCommand(options);
  const replace = options.replace ?? false;
  return { name: 'tesseract', setup(host) { host.commands.register(command, { replace }); } };
}
