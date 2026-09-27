import { yieldTurn } from 'safe-bash-contracts/yield';
import { Budget, UnrtfError, type RtfToken, type UnrtfOptions } from './contracts.js';
const letter = (byte: number) => byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122;
const digit = (byte: number) => byte >= 48 && byte <= 57;
const hex = (byte: number) => digit(byte) ? byte - 48 : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1;
// The intrinsic getter checks the internal typed-array kind across realms;
// instanceof rejects valid foreign views and ordinary tags can be forged.
const typedArrayKind = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag)!.get!;

export interface RtfTokenizer {
  next(): RtfToken | null | Promise<RtfToken | null>;
  close(failed: boolean): Promise<void>;
}

/** Flat tokens retain no tree or binary payload. Source chunks are borrowed only
 * until exhausted; callers must not mutate them while an invocation is active. */
export function createRtfTokenizer(source: AsyncIterable<Uint8Array>, options: UnrtfOptions, budget = new Budget(options)): RtfTokenizer {
  options = budget.options;
  const iterator = source[Symbol.asyncIterator]();
  let chunk: Uint8Array = new Uint8Array(), index = 0, offset = 0, pending: number | undefined;
  let depth = 0, roots = 0, header = false, tokenRetained = 0, closed = false;
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
  const readFast = (raw = false): number | Promise<number> => {
    while (pending !== undefined || (index < chunk.length && (offset === 0 || (offset & 4095) !== 0))) {
      budget.check(offset);
      if (pending !== undefined) {
        const byte = pending;
        pending = undefined;
        return byte;
      }
      budget.charge('work', 1, offset);
      offset++;
      const byte = chunk[index++]!;
      if (raw || byte !== 13) return byte;
    }
    return read(raw);
  };
  const emit = (token: RtfToken): RtfToken => { budget.charge('tokens', 1, token.offset); return token; };

  const finishSync = (): null => {
    if (depth || !header) fail('Unterminated or missing RTF root');
    return null;
  };

  const parseControl = async (at: number, initialControl: number): Promise<RtfToken> => {
    let control = initialControl;
    if (control < 0) fail('Truncated control', at);
    if (control === 39) {
      budget.bound('tokenBytes',4,at);
      const rh = readFast();
      const high = hex(typeof rh === 'number' ? rh : await rh);
      const rl = readFast();
      const low = hex(typeof rl === 'number' ? rl : await rl);
      if (high < 0 || low < 0) fail('Malformed hex escape', at);
      if (!header) fail('Missing RTF header', at);
      return emit({kind:'byte', byte:high * 16 + low, escaped:true, offset:at});
    }
    if (!letter(control)) {
      budget.bound('tokenBytes',2,at);
      if (!header) fail('Missing RTF header', at);
      return emit(control === 10 ? {kind:'control', name:'par', parameter:undefined, offset:at} : {kind:'symbol', name:String.fromCharCode(control), offset:at});
    }
    let name = '', size = 0;
    while (letter(control)) {
      budget.bound('tokenBytes', ++size, at); budget.charge('retainedBytes',2,at); tokenRetained += 2; name += String.fromCharCode(control);
      const rn = readFast();
      control = typeof rn === 'number' ? rn : await rn;
    }
    let parameter: number | undefined;
    const negative = control === 45;
    if (negative) {
      budget.bound('tokenBytes', ++size, at);
      const rneg = readFast();
      control = typeof rneg === 'number' ? rneg : await rneg;
    }
    if (digit(control)) {
      let value = 0;
      while (digit(control)) {
        budget.bound('tokenBytes', ++size, at);
        if (value > Math.floor((2147483648 - (control - 48)) / 10)) fail('Control parameter overflow', at);
        value = value * 10 + control - 48;
        const rd = readFast(name === 'bin');
        control = typeof rd === 'number' ? rd : await rd;
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
      for (let i = 0; i < parameter; i++) {
        const rb = readFast(true);
        if ((typeof rb === 'number' ? rb : await rb) < 0) fail('Truncated binary payload', at);
      }
      return emit({kind:'binary', length:parameter, offset:at});
    }
    return emit({kind:'control', name, parameter, offset:at});
  };

  const parseControlSync = (at: number, initialControl: number): RtfToken => {
    let control = initialControl;
    let name = '', size = 0;
    while (letter(control)) {
      budget.bound('tokenBytes', ++size, at); budget.charge('retainedBytes', 2, at); tokenRetained += 2; name += String.fromCharCode(control);
      control = readFast() as number;
    }
    let parameter: number | undefined;
    const negative = control === 45;
    if (negative) {
      budget.bound('tokenBytes', ++size, at);
      control = readFast() as number;
    }
    if (digit(control)) {
      let value = 0;
      while (digit(control)) {
        budget.bound('tokenBytes', ++size, at);
        if (value > Math.floor((2147483648 - (control - 48)) / 10)) fail('Control parameter overflow', at);
        value = value * 10 + control - 48;
        control = readFast() as number;
      }
      if (!negative && value > 2147483647) fail('Control parameter overflow', at);
      parameter = negative ? -value : value;
    } else if (negative) fail('Missing signed parameter', at);
    if (control !== 32 && control >= 0) pending = control;
    if (!header) {
      if (depth !== 1 || name !== 'rtf' || parameter !== 1) fail('Expected RTF version 1 header', at);
      header = true;
    }
    budget.release('retainedBytes', tokenRetained); tokenRetained = 0;
    return emit({kind:'control', name, parameter, offset:at});
  };

  const handleByte = (byte: number, at: number): RtfToken | null | Promise<RtfToken | null> | 'continue' => {
    if (byte < 0) return finishSync();
    if (byte === 10) return 'continue';
    if (byte === 123) {
      if (depth === 0 && ++roots !== 1) fail('RTF requires one root', at);
      budget.bound('depth', depth + 1, at); budget.charge('retainedBytes', 128, at); depth++;
      return emit({kind:'open', offset:at});
    }
    if (byte === 125) {
      if (!depth || !header) fail('Unexpected RTF closing group', at);
      depth--; budget.release('retainedBytes', 128);
      return emit({kind:'close', offset:at});
    }
    if (!depth) fail('RTF requires a root group', at);
    if (byte !== 92) {
      if (!header) fail('Missing RTF header', at);
      budget.bound('tokenBytes', 1, at);
      return emit({kind:'byte', byte:byte === 9 ? 32 : byte, escaped:false, offset:at});
    }
    const rc0 = readFast();
    if (typeof rc0 === 'number') {
      if (rc0 !== 39 && letter(rc0) && index + 32 < chunk.length && (offset & 4095) < 4000) {
        let look = index;
        let c = rc0;
        while (letter(c) && look < chunk.length) {
          c = chunk[look++]!;
          if (c === 13) break;
        }
        if (c !== 13 && !(rc0 === 98 && chunk[index] === 105 && chunk[index + 1] === 110)) {
          let dLook = look;
          let dc = c;
          if (dc === 45 && dLook < chunk.length) dc = chunk[dLook++]!;
          while (digit(dc) && dLook < chunk.length) {
            dc = chunk[dLook++]!;
            if (dc === 13) break;
          }
          if (dc !== 13 && dLook < chunk.length) {
            return parseControlSync(at, rc0);
          }
        }
      }
      if (rc0 !== 39 && !letter(rc0) && rc0 >= 0) {
        budget.bound('tokenBytes', 2, at);
        if (!header) fail('Missing RTF header', at);
        return emit(rc0 === 10 ? {kind:'control', name:'par', parameter:undefined, offset:at} : {kind:'symbol', name:String.fromCharCode(rc0), offset:at});
      }
      return parseControl(at, rc0);
    }
    return rc0.then(c => parseControl(at, c));
  };

  const nextAsync = async (pendingPromise: Promise<number>): Promise<RtfToken | null> => {
    let byte = await pendingPromise;
    for (;;) {
      const at = offset - 1;
      const res = handleByte(byte, at);
      if (res !== 'continue') return res instanceof Promise ? await res : res;
      const r = readFast();
      byte = typeof r === 'number' ? r : await r;
    }
  };

  return {
    next(): RtfToken | null | Promise<RtfToken | null> {
      for (;;) {
        const r0 = readFast();
        if (typeof r0 !== 'number') return nextAsync(r0);
        const at = offset - 1;
        const res = handleByte(r0, at);
        if (res !== 'continue') return res;
      }
    },
    async close(failed: boolean): Promise<void> {
      if (closed) return;
      closed = true;
      budget.release('retainedBytes', chunk.length + depth * 128 + tokenRetained);
      chunk = new Uint8Array(); pending = undefined;
      if (failed) {
        try { await iterator.return?.(); }
        catch { /* Preserve the primary parsing, budget or cancellation error. */ }
      } else await iterator.return?.();
    }
  };
}

export async function* tokenizeRtf(source: AsyncIterable<Uint8Array>, options: UnrtfOptions, budget = new Budget(options)): AsyncGenerator<RtfToken> {
  const tokenizer = createRtfTokenizer(source, options, budget);
  let failed = false;
  try {
    for (;;) {
      const next = tokenizer.next();
      const token = next instanceof Promise ? await next : next;
      if (!token) break;
      yield token;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await tokenizer.close(failed);
  }
}
