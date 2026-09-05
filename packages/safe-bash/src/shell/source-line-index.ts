import { ParseBudget } from "./parse-budget.js";

export class SourceLineIndex {
  #source: string;
  #scanned = 0;
  #newlines: number[] | undefined;

  constructor(source: string, readonly budget: ParseBudget) { this.#source = source; }

  get source(): string { return this.#source; }

  append(source: string): void { this.#source += source; }

  lineAt(position: number): number {
    this.budget.admit(0);
    if (!Number.isSafeInteger(position) || position < 0 || position > this.#source.length) throw new RangeError("Invalid source line position");
    if (position === 0 || position === 1 && this.#source[0] !== "\n") return 1;
    while (this.#scanned < position) {
      if (this.#scanned % 1024 === 0) this.budget.admit();
      if (this.#source.charCodeAt(this.#scanned) === 10) {
        this.budget.admit();
        (this.#newlines ??= []).push(this.#scanned);
      }
      this.#scanned++;
    }
    this.budget.admit(0);
    let low = 0;
    let high = this.#newlines?.length ?? 0;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.#newlines![middle]! < position) low = middle + 1;
      else high = middle;
    }
    return low + 1;
  }
}
