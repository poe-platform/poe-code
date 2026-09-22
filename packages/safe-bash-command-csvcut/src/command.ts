import { commandRuntimeIdentity, getCommandArguments, type CommandContext, type CommandDefinition } from 'safe-bash-contracts/command';
import { shellValueByteLength } from 'safe-bash-contracts/value';
import { FsError } from 'safe-bash-contracts/errors';
import { readBytes, writeBytes, type ByteSource } from 'safe-bash-contracts/io';
import { createOutputOperation, type OutputOperation } from 'safe-bash-contracts/output';
import type { VirtualShellPlugin } from 'safe-bash-contracts/plugin';
import { CsvBudget, CsvError, type CsvDialect, type CsvLimits } from 'safe-bash-csv-engine';
import { cutCsv, type CsvcutOptions } from './behavior.js';

export interface CsvcutInvocation extends CsvcutOptions { readonly filePath?: string; readonly encoding?: string; readonly help?: boolean; readonly version?: boolean; }
export interface CsvcutCommandOptions { readonly limits?: Partial<CsvLimits>; readonly replace?: boolean; }
export interface CsvcutResult { readonly exitCode: number; }
const booleanOptions: Record<string, keyof CsvcutInvocation> = {
  '-x': 'deleteEmptyRows', '--delete-empty-rows': 'deleteEmptyRows', '-H': 'headerless', '--no-header-row': 'headerless',
  '-n': 'names', '--names': 'names', '--zero': 'zero', '-l': 'lineNumbers', '--linenumbers': 'lineNumbers',
  '--add-bom': 'addBom', '-h': 'help', '--help': 'help', '-V': 'version', '--version': 'version'
};
const valueOptions = new Set(['-c', '--columns', '-C', '--not-columns', '-d', '--delimiter', '-q', '--quotechar', '-p', '--escapechar', '-e', '--encoding', '-K', '--skip-lines', '-u', '--quoting', '-z', '--maxfieldsize']);
const dialectFlags: Record<string, keyof CsvDialect> = { '-t': 'tabs', '--tabs': 'tabs', '-b': 'doubleQuote', '--no-doublequote': 'doubleQuote', '-S': 'skipInitialSpace', '--skipinitialspace': 'skipInitialSpace' };
function integer(value: string, budget: CsvBudget): number {
  budget.charge('work', value.length);
  // Explicit ASCII integer profile; never silently coerce fractions or exponents.
  let at = 0, end = value.length;
  const whitespace = (c: string): boolean => ' \t\r\n\v\f'.includes(c);
  while (at < end && whitespace(value[at]!)) at++;
  while (end > at && whitespace(value[end - 1]!)) end--;
  let sign = 1;
  if (value[at] === '-' || value[at] === '+') { if (value[at] === '-') sign = -1; at++; }
  let result = 0, digit = false;
  for (; at < end; at++) {
    const code = value.charCodeAt(at);
    if (code === 95 && digit && at + 1 < end) { digit = false; continue; }
    if (code < 48 || code > 57) throw new CsvError('ARGUMENT', 'Expected an ASCII integer');
    result = result * 10 + code - 48;
    if (!Number.isSafeInteger(result)) throw new CsvError('ARGUMENT', 'Integer exceeds supported range');
    digit = true;
  }
  if (!digit) throw new CsvError('ARGUMENT', 'Expected an ASCII integer');
  return sign * result;
}
export function parseCsvcutArguments(args: readonly string[], budget: CsvBudget): CsvcutInvocation {
  budget.charge("retainedBytes", 256 + args.length * 64);
  const options: { -readonly [K in keyof CsvcutInvocation]: CsvcutInvocation[K] } = {}, dialect: CsvDialect = {};
  let ended = false, operand = false;
  let quoting: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const raw = args[i]!;
    budget.charge('work', raw.length + 1);
    budget.charge('retainedBytes', raw.length * 8);
    if (!ended && raw === '--') { ended = true; continue; }
    if (ended || !raw.startsWith('-') || raw === '-') {
      if (operand) throw new CsvError('ARGUMENT', 'Only one CSV operand is accepted');
      options.filePath = raw; operand = true; continue;
    }
    const long = raw.startsWith('--'), equals = long ? raw.indexOf('=') : -1;
    let offset = 1;
    do {
      const flag = long ? (equals < 0 ? raw : raw.slice(0, equals)) : `-${raw[offset]}`;
      budget.charge('work', 1);
      const boolean = Object.hasOwn(booleanOptions, flag), dialectFlag = Object.hasOwn(dialectFlags, flag);
      if (boolean || dialectFlag) {
        if (equals >= 0) throw new CsvError('ARGUMENT', `${flag} does not accept a value`);
        if (boolean) Object.assign(options, { [booleanOptions[flag]!]: true });
        else Object.assign(dialect, { [dialectFlags[flag]!]: dialectFlags[flag] !== 'doubleQuote' });
        offset++; continue;
      }
      if (!valueOptions.has(flag)) throw new CsvError('ARGUMENT', `Unknown option ${flag}`);
      const inline = long ? (equals < 0 ? undefined : raw.slice(equals + 1)) : (offset + 1 < raw.length ? raw.slice(offset + 1) : undefined);
      const value = inline ?? args[++i];
      if (inline === undefined && value !== undefined) {
        budget.charge('work', value.length + 1);
        budget.charge('retainedBytes', value.length * 8);
      }
      const negativeInteger = value !== undefined && value.length > 1 && value[0] === '-' && value.charCodeAt(1) >= 48 && value.charCodeAt(1) <= 57;
      if (value === undefined || (inline === undefined && value.startsWith('-') && value !== '-' && !negativeInteger))
        throw new CsvError('ARGUMENT', `Expected a value for ${flag}`);
      if (flag === '-c' || flag === '--columns') options.include = value;
      else if (flag === '-C' || flag === '--not-columns') options.exclude = value;
      else if (flag === '-d' || flag === '--delimiter') dialect.delimiter = value;
      else if (flag === '-q' || flag === '--quotechar') dialect.quote = value;
      else if (flag === '-p' || flag === '--escapechar') dialect.escape = value;
      else if (flag === '-e' || flag === '--encoding') {
        options.encoding = value;
      } else if (flag === '-K' || flag === '--skip-lines') dialect.skipLines = integer(value, budget);
      else if (flag === '-u' || flag === '--quoting') {
        const mode = integer(value, budget);
        if (mode < 0 || mode > 3) throw new CsvError('ARGUMENT', 'Invalid quoting value');
        quoting = mode;
      } else {
        integer(value, budget);
        throw new CsvError('UNSUPPORTED', 'Native character field limits are unqualified; use invocation fieldBytes limits');
      }
      break;
    } while (!long && offset < raw.length);
  }
  if (quoting !== undefined) {
    if (quoting !== 0 && quoting !== 3) throw new CsvError('UNSUPPORTED', 'Quoting modes 1 and 2 are not qualified');
    dialect.quoting = quoting;
  }
  options.dialect = dialect;
  return options;
}
const help = 'usage: csvcut [-c COLUMNS] [-C NOT_COLUMNS] [-n] [-x] [--zero] [FILE]\nProject CSV columns from stdin or a literal VFS path.\nReader profile: utf8-sig-permissive-v1; quoting 0/3 only.\n';
const extent = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;

async function retireInput(retire: () => Promise<unknown>, failed: boolean): Promise<void> {
  try { await retire(); } catch (error) { if (!failed) throw error; }
}

/** CLI and typed SDK entry share bounded byte projection and invocation ownership. */
export async function csvcut(context: CommandContext, invocation?: CsvcutInvocation, configuration: CsvcutCommandOptions = {}): Promise<CsvcutResult> {
  const controller = new AbortController(), signal = controller.signal;
  let accepting = true, closing: Promise<void> | undefined;
  let stdout: OutputOperation | undefined, stderr: OutputOperation | undefined;
  let stream: AsyncGenerator<Uint8Array> | undefined;
  const abort = (): void => controller.abort(context.signal.reason);
  const cleanup = (): Promise<void> => {
    if (closing) return closing;
    accepting = false; controller.abort(new CsvError('INPUT', 'csvcut invocation closed'));
    closing = Promise.resolve().then(async () => {
      if (task) await task.catch(() => {});
      const results = await Promise.allSettled([stream?.return(undefined), stdout?.close(), stderr?.close()]);
      {
        context.signal.removeEventListener('abort', abort);
        const failures = results.filter(r => r.status === 'rejected').map(r => r.reason);
        if (failures.length) throw new AggregateError(failures, 'csvcut output cleanup failed');
      }
    });
    return closing;
  };
  context.registerCleanup?.(cleanup);
  const supplied = invocation && Object.freeze({ ...invocation, dialect: Object.freeze({ ...invocation.dialect }) });
  const limits = Object.freeze({ ...configuration.limits });
  const task = Promise.resolve().then(async () => {
    context.signal.throwIfAborted();
    if (!accepting) throw new CsvError('INPUT', 'csvcut invocation closed');
    context.signal.addEventListener('abort', abort, { once: true });
    if (context.signal.aborted) abort();
    const budget = new CsvBudget(limits, signal);
    stdout = createOutputOperation({ signal }, context.stdout);
    stderr = createOutputOperation({ signal }, context.stderr);
    try {
      const chargeText = (value: string): void => {
        budget.charge('argumentBytes', value.length * 3);
        budget.charge('work', value.length + 1); budget.text(value);
      };
      let options: CsvcutInvocation;
      if (supplied) {
        for (const value of [...Object.values(supplied), ...Object.values(supplied.dialect)]) if (typeof value === 'string') chargeText(value);
        options = supplied;
      } else {
        for (const arg of context.args) chargeText(arg);
        budget.charge('retainedBytes', context.args.length * 128);
        const carrier = getCommandArguments(context);
        for (let i = 0; i < carrier.values.length; i++) {
          const length = shellValueByteLength(carrier.values[i]!);
          budget.charge('retainedBytes', length * 3); budget.charge('work', length);
          budget.charge('argumentBytes', Math.max(0, length - context.args[i]!.length * 3));
          try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(carrier.bytes(i)!); }
          catch { throw new CsvError('ARGUMENT', 'Arguments must be valid UTF-8'); }
        }
        options = parseCsvcutArguments(context.args, budget);
      }
      if (options.encoding !== undefined && !['utf-8-sig', 'utf8-sig'].includes(options.encoding.toLowerCase()))
        throw new CsvError('UNSUPPORTED', 'Only utf-8-sig decoding is qualified');
      if (options.help || options.version) {
        const text = options.help ? help : 'csvcut 2.2.0 (utf8-sig-permissive-v1 candidate)\n';
        budget.charge('work', text.length); budget.charge('retainedBytes', text.length * 3);
        const bytes = new TextEncoder().encode(text); budget.charge('outputBytes', bytes.length);
        await writeBytes(stdout.output, bytes, signal); return { exitCode: 0 };
      }
      stream = cutCsv((readSignal) => {
        readSignal.throwIfAborted();
        const path = options.filePath ?? '-';
        if (path.includes('\0')) throw new CsvError('ARGUMENT', 'NUL is unavailable in VFS paths');
        let input: ByteSource;
        if (path === '-') input = context.stdin;
        else {
          const resolved = path.startsWith('/') ? path : `${context.cwd}/${path}`;
          if (context.fs.readStream) input = context.fs.readStream(resolved, { signal: readSignal });
          else input = (async function* () {
            const maxBytes = Math.min(budget.limits.inputBytes - budget.accounting.inputBytes, budget.limits.retainedBytes - budget.accounting.retainedBytes);
            const bytes = await context.fs.readFile(resolved, { signal: readSignal, maxBytes });
            readSignal.throwIfAborted();
            if (extent.call(bytes) > maxBytes) throw new CsvError('LIMIT', 'VFS read limit exceeded');
            budget.charge("retainedBytes", extent.call(bytes) as number);
            yield bytes;
          })();
        }
        return (async function* () {
          const producer = input[Symbol.asyncIterator]();
          const next = producer.next;
          let retirement: Promise<IteratorResult<Uint8Array>> | undefined;
          const retire = (): Promise<IteratorResult<Uint8Array>> => retirement ??= Promise.resolve().then(() =>
            producer.return ? producer.return() : { done: true, value: undefined });
          let received = 0, failed = false;
          try {
            const owned = { [Symbol.asyncIterator]: () => ({ next: () => next.call(producer), return: retire }) };
            for await (const bytes of readBytes(owned, readSignal)) {
              received += extent.call(bytes) as number; context.inputBudget?.check(received);
              yield bytes;
            }
          } catch (error) { failed = true; throw error; }
          finally { await retireInput(retire, failed); }
        })();
      }, options, { signal, budget });
      for await (const bytes of stream) { await writeBytes(stdout.output, bytes, signal); }
      return { exitCode: 0 };
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof CsvError) && !(error instanceof FsError)) throw error;
      const text = `csvcut: ${error.message}\n`;
      if (text.length * 3 <= budget.limits.retainedBytes - budget.accounting.retainedBytes && text.length <= budget.limits.work - budget.accounting.work) {
        budget.charge('retainedBytes', text.length * 3); budget.charge('work', text.length);
        const bytes = new TextEncoder().encode(text);
        if (bytes.length <= budget.limits.outputBytes - budget.accounting.outputBytes) {
          budget.charge('outputBytes', bytes.length); await writeBytes(stderr.output, bytes, signal);
        }
      }
      return { exitCode: error instanceof CsvError && error.code === 'ARGUMENT' ? 2 : 1 };
    } finally { budget.dispose(); }
  });
  try { return await task; }
  finally { try { await cleanup(); } finally { context.signal.throwIfAborted(); } }
}
export function createCsvcutCommand(options: CsvcutCommandOptions = {}): Omit<CommandDefinition, 'execute'> & { readonly execute: (context: CommandContext) => Promise<CsvcutResult> } {
  const configuration = Object.freeze({ ...options, limits: Object.freeze({ ...options.limits }) });
  return Object.freeze({ name: 'csvcut', runtimeIdentity: commandRuntimeIdentity, description: 'Project CSV columns from byte streams',
    execute(context: CommandContext) { return csvcut(context, undefined, configuration); } });
}
export const csvcutCommand = createCsvcutCommand();
export function csvcutCommands(options: CsvcutCommandOptions = {}): VirtualShellPlugin {
  const command = createCsvcutCommand(options), replace = options.replace ?? false;
  return { name: 'csvcut', setup(host) { host.commands.register(command, { replace }); } };
}
