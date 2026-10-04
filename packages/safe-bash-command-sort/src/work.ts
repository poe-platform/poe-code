import { yieldTurn } from "safe-bash-contracts/yield";

export class SortWork {
  #pending = 0;

  constructor(readonly signal: AbortSignal) {
    this.signal.throwIfAborted();
  }

  charge(units = 1): Promise<void> | undefined {
    this.#pending += units;
    if (this.#pending >= 4096) {
      return this.#checkpoint();
    }
  }

  async #checkpoint(): Promise<void> {
    while (this.#pending >= 4096) {
      this.#pending -= 4096;
      await yieldTurn(this.signal);
      this.signal.throwIfAborted();
    }
  }
}

export async function sortRecords<Record>(records: Record[], compare: (left: Record, right: Record) => number | Promise<number>, work: SortWork): Promise<Record[]> {
  if (records.length < 2) return records;
  let source = records;
  let target = new Array<Record>(records.length);
  for (let width = 1; width < records.length; width *= 2) {
    for (let begin = 0; begin < records.length; begin += width * 2) {
      const middle = Math.min(begin + width, records.length);
      const end = Math.min(begin + width * 2, records.length);
      let left = begin;
      let right = middle;
      for (let index = begin; index < end; index++) {
        const checkpoint = work.charge();
        if (checkpoint) await checkpoint;
        if (left < middle) {
          if (right === end) {
            target[index] = source[left++]!;
            continue;
          }
          const compared = compare(source[left]!, source[right]!);
          const order = typeof compared === "number" ? compared : await compared;
          if (order <= 0) {
            target[index] = source[left++]!;
            continue;
          }
        }
        target[index] = source[right++]!;
      }
    }
    [source, target] = [target, source];
  }
  return source;
}

