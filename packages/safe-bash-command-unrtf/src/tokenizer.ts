import { yieldTurn } from 'safe-bash-contracts/yield';
import { Budget, UnrtfError, type RtfToken, type UnrtfOptions } from './contracts.js';
const letter = (byte: number) => byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122;
const digit = (byte: number) => byte >= 48 && byte <= 57;
const hex = (byte: number) => digit(byte) ? byte - 48 : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1;
// The intrinsic getter checks the internal typed-array kind across realms;
// instanceof rejects valid foreign views and ordinary tags can be forged.
const typedArrayKind = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag)!.get!;

/** Flat tokens retain no tree or binary payload. Source chunks are borrowed only
 * until exhausted; callers must not mutate them while an invocation is active. */
export async function* tokenizeRtf(source: AsyncIterable<Uint8Array>, options: UnrtfOptions, budget = new Budget(options)): AsyncGenerator<RtfToken> {
  options = budget.options;
  const iterator = source[Symbol.asyncIterator]();
  let chunk: Uint8Array = new Uint8Array(), index = 0, offset = 0, pending: number | undefined;
  let depth = 0, roots = 0, header = false, tokenRetained = 0, failed = false;
  const fail = (message: string, at = offset): never => { throw new UnrtfError('E_PARSE', message, at); };
  const read = async (raw = false): Promise<number> => {
    for (;;) {
      budget.check(offset);
      if (pending !== undefined) { const byte = pending; pending = undefined; return byte; }
      while (index === chunk.length) {
        budget.release('retainedBytes', chunk.length); chunk = new Uint8Array(); index = 0;
        budget.charge('work', 1, offset);
        const signal = options.signal;
        let abort: (() => void) | undefined;
        try {
          const next = await Promise.race([iterator.next(), new Promise<never>((_, reject) => {
            abort = () => reject(new UnrtfError('E_CANCELLED', 'RTF invocation cancelled', offset));
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
          })]);
          budget.check(offset);
          if (next.done) return -1;
          if (!ArrayBuffer.isView(next.value) || typedArrayKind.call(next.value) !== 'Uint8Array') fail('RTF input must be byte chunks');
          budget.charge('inputBytes', next.value.length, offset);
          budget.charge('retainedBytes', next.value.length, offset);
          chunk = next.value; index = 0;
        } finally { if (abort) signal.removeEventListener('abort', abort); }
      }
      if (offset > 0 && offset % 4096 === 0) {
        await yieldTurn();
        budget.check(offset);
      }
      budget.charge('work', 1, offset);
      offset++;
      const byte = chunk[index++]!;
      if (raw || byte !== 13) return byte;
    }
  };
  const emit = (token: RtfToken): RtfToken => { budget.charge('tokens', 1, token.offset); return token; };
  try {
    for (;;) {
      const byte = await read();
      const at = offset - 1;
      if (byte < 0) break;
      if (byte === 10) continue;
      if (byte === 123) {
        if (depth === 0 && ++roots !== 1) fail('RTF requires one root', at);
        budget.bound('depth', depth + 1, at); budget.charge('retainedBytes', 128, at); depth++; yield emit({kind:'open', offset:at}); continue;
      }
      if (byte === 125) {
        if (!depth || !header) fail('Unexpected RTF closing group', at);
        depth--; budget.release('retainedBytes', 128); yield emit({kind:'close', offset:at}); continue;
      }
      if (!depth) fail('RTF requires a root group', at);
      if (byte !== 92) {
        if (!header) fail('Missing RTF header', at);
        budget.bound('tokenBytes', 1, at);
        yield emit({kind:'byte', byte:byte === 9 ? 32 : byte, escaped:false, offset:at}); continue;
      }
      let control = await read();
      if (control < 0) fail('Truncated control', at);
      if (control === 39) {
        budget.bound('tokenBytes',4,at);
        const high = hex(await read()), low = hex(await read());
        if (high < 0 || low < 0) fail('Malformed hex escape', at);
        if (!header) fail('Missing RTF header', at);
        yield emit({kind:'byte', byte:high * 16 + low, escaped:true, offset:at}); continue;
      }
      if (!letter(control)) {
        budget.bound('tokenBytes',2,at);
        if (!header) fail('Missing RTF header', at);
        yield emit(control === 10 ? {kind:'control', name:'par', parameter:undefined, offset:at} : {kind:'symbol', name:String.fromCharCode(control), offset:at}); continue;
      }
      let name = '', size = 0;
      while (letter(control)) {
        budget.bound('tokenBytes', ++size, at); budget.charge('retainedBytes',2,at); tokenRetained += 2; name += String.fromCharCode(control); control = await read();
      }
      let parameter: number | undefined;
      const negative = control === 45;
      if (negative) { budget.bound('tokenBytes', ++size, at); control = await read(); }
      if (digit(control)) {
        let value = 0;
        while (digit(control)) {
          budget.bound('tokenBytes', ++size, at);
          if (value > Math.floor((2147483648 - (control - 48)) / 10)) fail('Control parameter overflow', at);
          // Binary lookahead belongs to the raw payload unless it is the
          // optional space delimiter; do not discard its first CR byte.
          value = value * 10 + control - 48; control = await read(name === 'bin');
        }
        if (!negative && value > 2147483647) fail('Control parameter overflow', at);
        parameter = negative ? -value : value;
      } else if (negative) fail('Missing signed parameter', at);
      if (control !== 32 && control >= 0) pending = control;
      if (!header) {
        if (depth !== 1 || name !== 'rtf' || parameter !== 1) fail('Expected RTF version 1 header', at);
        header = true;
      }
      budget.release('retainedBytes',tokenRetained); tokenRetained = 0;
      if (name === 'bin') {
        if (parameter === undefined || parameter < 0) throw new UnrtfError('E_PARSE', 'Invalid binary count', at);
        budget.charge('binaryBytes', parameter, at);
        for (let i = 0; i < parameter; i++) if (await read(true) < 0) fail('Truncated binary payload', at);
        yield emit({kind:'binary', length:parameter, offset:at});
      } else yield emit({kind:'control', name, parameter, offset:at});
    }
    if (depth || !header) fail('Unterminated or missing RTF root');
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    budget.release('retainedBytes', chunk.length + depth * 128 + tokenRetained);
    chunk = new Uint8Array(); pending = undefined;
    if (failed) {
      try { await iterator.return?.(); }
      catch { /* Preserve the primary parsing, budget or cancellation error. */ }
    } else await iterator.return?.();
  }
}
