import { FsError, shellValueByteLength, type CommandContext } from 'safe-bash-contracts';

export interface LlmInputLimits {
  readonly maxInputBytes?: number;
  readonly maxBufferedInputBytes?: number;
}

/** Per-invocation UTF-8/raw-byte admission; streamed bytes do not consume the
 * materialization allowance. This measures input bytes, not JavaScript heap. */
export function createLlmInputBudget(limits: LlmInputLimits = {}, parent?: CommandContext['inputBudget']) {
  for (const [name, value] of Object.entries({maxInputBytes:limits.maxInputBytes,maxBufferedInputBytes:limits.maxBufferedInputBytes})) {
    if (value !== undefined && value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) throw new RangeError(`Invalid LLM input limit: ${name}`);
  }
  const totalLimit = Math.min(limits.maxInputBytes ?? Infinity, parent?.maxBytes ?? Infinity);
  const bufferedLimit = limits.maxBufferedInputBytes ?? Infinity;
  let total = 0, buffered = 0;
  const check = (size: number, materialized = false): void => {
    if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('Invalid LLM input size');
    if (materialized && size > bufferedLimit - buffered) throw new FsError('EFBIG', {message:'llm buffered input byte limit exceeded'});
    if (size > totalLimit - total) throw new FsError('EFBIG', {message:'llm input byte limit exceeded'});
    parent?.check(total + size);
  };
  return {
    check,
    get totalBytes(): number { return total; },
    remaining(materialized = false): number { return Math.min(totalLimit - total, materialized ? bufferedLimit - buffered : Infinity); },
    admit(size: number, materialized = false): void {
      check(size, materialized);
      total += size;
      if (materialized) buffered += size;
    },
    /** Charge materialization of bytes already admitted as streamed input. */
    materialize(size: number): void {
      if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('Invalid LLM input size');
      if (size > bufferedLimit - buffered) throw new FsError('EFBIG', {message:'llm buffered input byte limit exceeded'});
      buffered += size;
    },
    admitText(text: string): void {
      const size = shellValueByteLength(text);
      check(size, true); total += size; buffered += size;
    },
  };
}
