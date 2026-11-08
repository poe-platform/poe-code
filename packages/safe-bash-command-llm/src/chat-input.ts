import {editChatPrompt} from './chat-editor.js';
import type {CommandContext, OutputOperation} from 'safe-bash-contracts';
import {createLlmSpool} from './retained-spool.js';
import {waitForSource} from './request-source.js';
import {isPythonWhitespace, stripPythonWhitespace} from './python-whitespace.js';
import {yieldTurn} from 'safe-bash-contracts/yield';

type Spool = Awaited<ReturnType<typeof createLlmSpool>>;

/** One invocation owns stdin and caller-backed prompt staging. */
export function createChatInput(options: {context: CommandContext; operation: OutputOperation;
  resolveFragments(paths: readonly string[]): Promise<void>;
  write(text: string): Promise<void>; diagnostic(text: string): Promise<void>; admit(bytes: number, materialized: boolean): void}) {
  const {context, operation} = options, {signal} = context;
  let iterator: AsyncIterator<Uint8Array> | undefined, pending: Uint8Array = new Uint8Array(0), position = 0, ended = false;
  let multi: Spool | undefined, multiSize = 0, endToken = '!end', iterations = 0;
  const create = () => operation.acquire(() => createLlmSpool(context.fs, context.cwd, signal, 'input'), spool => spool.close());
  const chunk = async (): Promise<IteratorResult<Uint8Array>> => {
    while (position === pending.length) {
      if (ended) return {done: true, value: undefined};
      iterator ??= await operation.acquire<AsyncIterator<Uint8Array>>(() => context.stdinInput
        ? {next: () => context.stdinInput!.readAvailable ? context.stdinInput!.readAvailable(4096, signal, 10) : context.stdinInput!.read(1, signal)}
        : context.stdin[Symbol.asyncIterator](), async input => {await input.return?.();});
      const next = await waitForSource(() => iterator!.next(), signal);
      if (next.done) {ended = true; continue;}
      if (!(next.value instanceof Uint8Array)) throw new TypeError('Byte sources must yield Uint8Array chunks');
      options.admit(next.value.length, false); pending = next.value; position = 0;
      await yieldTurn(signal);
    }
    const start = position;
    while (position < pending.length && position - start < 4096) {const byte = pending[position++]!; if (byte === 10) break;}
    return {done: false, value: pending.subarray(start, position)};
  };
  const inspect = async (spool: Spool) => {
    let probe = '', whitespace = '', overflow = false;
    const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
    const accept = (text: string) => {for (const char of text) {
      if (isPythonWhitespace(char)) {if (probe && whitespace.length <= 4096) whitespace += char;}
      else {if (probe.length + whitespace.length + char.length > 4096) overflow = true;
        if (!overflow) probe += whitespace + char;
        whitespace = '';}
    }};
    for await (const bytes of spool.replay()) {accept(decoder.decode(bytes, {stream: true})); await yieldTurn(signal);}
    accept(decoder.decode());
    return {probe, exact: !overflow};
  };
  const line = async () => {
    const spool = await create(); let size = 0, seen = false;
    while (true) {
      const next = await chunk();
      if (next.done) return seen ? {spool, size} : (await spool.close(), undefined);
      let bytes = next.value;
      if (!bytes.length) continue;
      seen = true;
      const last = bytes[bytes.length - 1]!;
      const newline = last === 10;
      if (newline) bytes = bytes.subarray(0, -1);
      await spool.write(bytes); size += bytes.length;
      if (newline) return {spool, size};
    }
  };
  const control = async (spool: Spool) => {
    let value = ''; const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
    for await (const bytes of spool.replay()) {options.admit(bytes.length, true); value += decoder.decode(bytes, {stream: true});}
    return value + decoder.decode();
  };
  const words = (value: string): string[] => {
    const result: string[] = []; let word = '';
    for (const char of value) {if (isPythonWhitespace(char)) {if (word) result.push(word); word = '';} else word += char;}
    if (word) result.push(word); return result;
  };
  return {
    approvalInput: (): AsyncIterator<Uint8Array> => ({next: chunk}),
    async next(): Promise<{spool: Spool; exit: boolean; includeInitialFragments: boolean}> {
      while (true) {
        await options.write(multi ? ' ' : '> ');
        const value = await line();
        if (!value) throw new Error('Aborted!');
        if (!value.size) {await value.spool.close(); continue;}
        let includeInitialFragments = iterations++ === 0;
        let inspected = await inspect(value.spool);
        if (inspected.probe.startsWith('!multi')) {
          const bits = words(stripPythonWhitespace(await control(value.spool)));
          if (bits.length > 1) endToken = '!end ' + bits.slice(1).join(' ');
          multi ??= await create(); await value.spool.close(); continue;
        }
        if (inspected.exact && inspected.probe === '!edit') {
          await value.spool.close();
          const edited = await editChatPrompt({...options, context: {...context, stdin: {async *[Symbol.asyncIterator]() {
            while (true) {const next = await chunk(); if (next.done) return; yield next.value;}
          }}}});
          if (!edited) {await options.diagnostic('Editor closed without saving.\n'); continue;}
          value.spool = edited; value.size = 0;
          for await (const bytes of edited.replay()) value.size += bytes.length;
          inspected = await inspect(edited);
        }
        const fragments: string[] = [];
        if (inspected.probe.startsWith('!fragment ')) {
          includeInitialFragments = false;
          const text = await control(value.spool);
          const lines: string[] = []; let start = 0;
          for (let index = 0; index < text.length; index++) {
            if (!['\n', '\r', '\v', '\f', '\x1c', '\x1d', '\x1e', '\x85', '\u2028', '\u2029'].includes(text[index]!)) continue;
            lines.push(text.slice(start, index));
            if (text[index] === '\r' && text[index + 1] === '\n') index++;
            start = index + 1;
          }
          if (start < text.length) lines.push(text.slice(start));
          const promptLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith('!fragment ')) fragments.push(...words(stripPythonWhitespace(line).slice(10)));
            else promptLines.push(line);
          }
          await value.spool.close(); value.spool = await create();
          const bytes = new TextEncoder().encode(promptLines.join('\n'));
          await value.spool.write(bytes); value.size = bytes.length;
        }
        if (fragments.length) await options.resolveFragments(fragments);
        if (multi) {
          if (stripPythonWhitespace(inspected.exact ? inspected.probe : inspected.probe.startsWith('!end') ? await control(value.spool) : '') === endToken) {
            await value.spool.close(); value.spool = multi; multi = undefined; multiSize = 0;
          } else {
            if (value.size) {
              if (multiSize) {await multi.write(Uint8Array.of(10)); multiSize++; options.admit(1, false);}
              for await (const bytes of value.spool.replay()) await multi.write(bytes);
              multiSize += value.size;
            }
            await value.spool.close(); continue;
          }
        }
        const final = await inspect(value.spool);
        return {spool: value.spool, includeInitialFragments, exit: final.exact && (final.probe === 'exit' || final.probe === 'quit')};
      }
    }
  };
}
