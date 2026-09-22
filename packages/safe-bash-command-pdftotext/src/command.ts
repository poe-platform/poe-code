import { commandRuntimeIdentity, getCommandArguments, type CommandContext, type CommandDefinition } from 'safe-bash-contracts/command';
import { writeBytes } from 'safe-bash-contracts/io';
import { createOutputOperation, type OutputOperation } from 'safe-bash-contracts/output';
import type { VirtualShellPlugin } from 'safe-bash-contracts/plugin';
import { shellValueByteLength } from 'safe-bash-contracts/value';
import { parsePdftotextArguments, PdftotextAdmissionError, type PdftotextArguments } from './admission.js';
import { defaultOutputName } from './arguments.js';

export interface PdftotextCommandOptions {
  readonly maxArgumentBytes?: number;
  readonly maxOutputBytes?: number;
  readonly replace?: boolean;
}
export interface PdftotextRunOptions extends PdftotextCommandOptions {
  readonly input?: string;
  readonly output?: string;
  readonly numbers?: Partial<PdftotextArguments['numbers']>;
  readonly flags?: Partial<PdftotextArguments['flags']>;
  readonly encoding?: string;
  readonly eol?: string;
  readonly removeHyphens?: string;
  /** CLI-compatible UTF-8 password profile, truncated to 32 bytes. Raw passwords are not supported. */
  readonly userPassword?: string;
  readonly ownerPassword?: string;
}
export interface PdftotextResult {
  readonly exitCode: 0 | 99;
  readonly extractionQualified: false;
  readonly outputBytes: number;
}
const numberFlags = { firstPage: '-f', lastPage: '-l', resolution: '-r', x: '-x', y: '-y', width: '-W', height: '-H', fixedPitch: '-fixed', colSpacing: '-colspacing' } as const;
const booleanFlags = { layout: '-layout', raw: '-raw', noDiagonal: '-nodiag', htmlMeta: '-htmlmeta', tsv: '-tsv', listEnc: '-listenc', noPageBreaks: '-nopgbrk', urls: '-urls', bbox: '-bbox', bboxLayout: '-bbox-layout', cropBox: '-cropbox', quiet: '-q', version: '-v', help: '-h' } as const;

async function execute(context: CommandContext, configuration: PdftotextCommandOptions, sdk?: PdftotextRunOptions): Promise<PdftotextResult> {
  const controller = new AbortController(), signal = controller.signal;
  const abort = (): void => controller.abort(context.signal.reason);
  let stdout: OutputOperation | undefined, stderr: OutputOperation | undefined;
  let task: Promise<PdftotextResult | undefined> = Promise.resolve(undefined);
  let closing: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    if (closing) return closing;
    closing = Promise.resolve().then(async () => {
      await Promise.allSettled([task]);
      context.signal.removeEventListener('abort', abort);
      const closed = await Promise.allSettled([stdout?.close(), stderr?.close()]);
      const failures = closed.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'pdftotext output cleanup failed');
    });
    controller.abort(new Error('pdftotext invocation closed'));
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
      if (!Number.isSafeInteger(value) || value < 0 || value > 1_048_576) throw new RangeError('Invalid pdftotext invocation limit');
    }
    stdout = createOutputOperation({ signal }, context.stdout);
    stderr = createOutputOperation({ signal }, context.stderr);
    let outputBytes = 0;
    const write = async (operation: OutputOperation, message: string): Promise<void> => {
      signal.throwIfAborted();
      const size = shellValueByteLength(message);
      if (size > maxOutputBytes - outputBytes) throw new RangeError('pdftotext exhausted outputBytes');
      outputBytes += size;
      await writeBytes(operation.output, new TextEncoder().encode(message), signal);
    };
    let parsed: PdftotextArguments | undefined;
    try {
      let args = context.args;
      if (sdk) {
        const values: string[] = [];
        let extent = 0;
        const append = (value: string): void => {
          signal.throwIfAborted();
          if (value.length + 1 > maxArgumentBytes - extent) throw new PdftotextAdmissionError('Argument limit exceeded');
          extent += shellValueByteLength(value) + 1;
          if (extent > maxArgumentBytes) throw new PdftotextAdmissionError('Argument limit exceeded');
          values.push(value);
        };
        for (const key of Object.keys(numberFlags) as (keyof typeof numberFlags)[]) {
          const value = sdk.numbers?.[key];
          if (value !== undefined) {
            let decimal = String(value);
            const exponentAt = decimal.indexOf('e');
            if (Number.isFinite(value) && exponentAt !== -1) {
              const sign = value < 0 ? '-' : '';
              const mantissa = decimal.slice(sign.length, exponentAt);
              const dotAt = mantissa.indexOf('.');
              const digits = mantissa.replace('.', '');
              const point = (dotAt === -1 ? mantissa.length : dotAt) + Number(decimal.slice(exponentAt + 1));
              // Finite JS numbers bound this expansion to at most 327 characters.
              decimal = sign + (point <= 0 ? '0.' + '0'.repeat(-point) + digits
                : point >= digits.length ? digits + '0'.repeat(point - digits.length)
                  : digits.slice(0, point) + '.' + digits.slice(point));
            }
            append(numberFlags[key]); append(decimal);
          }
        }
        for (const key of Object.keys(booleanFlags) as (keyof typeof booleanFlags)[]) if (sdk.flags?.[key]) append(booleanFlags[key]);
        for (const [flag, value] of [['-enc', sdk.encoding], ['-eol', sdk.eol], ['-remove-hyphens', sdk.removeHyphens], ['-upw', sdk.userPassword], ['-opw', sdk.ownerPassword]] as const) {
          if (value !== undefined) { append(flag); append(value); }
        }
        append('--');
        if (sdk.input !== undefined) append(sdk.input);
        if (sdk.output !== undefined) append(sdk.output);
        args = values;
      }
      parsed = parsePdftotextArguments(args, signal, { inputBytes: maxArgumentBytes });
      if (!sdk) {
        const carrier = getCommandArguments(context);
        for (let index = 0; index < carrier.values.length; index++) {
          signal.throwIfAborted();
          try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(carrier.bytes(index)!); }
          catch { throw new PdftotextAdmissionError('Only UTF-8 CLI arguments are admitted'); }
        }
      }
      for (const diagnostic of parsed.diagnostics) await write(stderr!, diagnostic);
      if (parsed.flags.help) await write(stdout!, 'Usage: pdftotext [options] PDF-file [text-file]\nVFS profile: PDF extraction is unavailable.\nOptions use exact spellings and separate operands; -- admits literal paths.\n');
      else if (parsed.flags.version) await write(stdout!, 'pdftotext safe-bash admission profile\nReference: Poppler 26.09.90 (0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46)\nExtraction: unavailable\n');
      else if (parsed.flags.listEnc) await write(stdout!, 'UTF-8\nUTF-16\nLatin1\nASCII7\n');
      else {
        if (!['all', 'none', 'soft'].includes(parsed.removeHyphens)) throw new PdftotextAdmissionError('Invalid remove-hyphens value');
        if (!['UTF-8', 'UTF-16', 'Latin1', 'ASCII7'].includes(parsed.encoding)) throw new PdftotextAdmissionError('Unsupported output encoding');
        if ((sdk && sdk.input === undefined) || parsed.files.length < 1 || parsed.files.length > 2) throw new PdftotextAdmissionError('Expected PDF-file and optional text-file');
        if (!parsed.files[1]) defaultOutputName(parsed.files[0]!, parsed.flags.htmlMeta, signal, { inputBytes: maxArgumentBytes });
        throw new PdftotextAdmissionError('Qualified PDF font/text/layout engine is unavailable');
      }
      return { exitCode: 0, extractionQualified: false, outputBytes };
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof PdftotextAdmissionError)) throw error;
      if (!parsed?.flags.quiet) await write(stderr!, 'pdftotext: ' + error.message + '\n');
      return { exitCode: 99, extractionQualified: false, outputBytes };
    }
  });
  try { return (await task)!; }
  finally { await cleanup(); context.signal.throwIfAborted(); }
}

export function pdftotext(context: CommandContext, options: PdftotextRunOptions): Promise<PdftotextResult> {
  const invocation = Object.freeze({ ...options, numbers: Object.freeze({ ...options.numbers }), flags: Object.freeze({ ...options.flags }) });
  return execute(context, invocation, invocation);
}
export function createPdftotextCommand(options: PdftotextCommandOptions = {}): CommandDefinition {
  const configuration = Object.freeze({ ...options });
  return Object.freeze({ name: 'pdftotext', runtimeIdentity: commandRuntimeIdentity,
    description: 'VFS pdftotext admission profile (extraction unavailable)',
    execute(context: CommandContext) { return execute(context, configuration); } });
}
export const pdftotextCommand = createPdftotextCommand();
export function pdftotextCommands(options: PdftotextCommandOptions = {}): VirtualShellPlugin {
  const command = createPdftotextCommand(options), replace = options.replace ?? false;
  return { name: 'pdftotext', setup(host) { host.commands.register(command, { replace }); } };
}
