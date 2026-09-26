import { CsplitError } from "./internal.js";
import { Lines, Outputs } from "./io.js";
import { Matcher, type Pattern } from "./patterns.js";

export class Splitter {
  private next = 1;
  private current = 0;
  constructor(readonly input: Lines, readonly output: Outputs, readonly matcher: Matcher) {}
  private remove(): Uint8Array | undefined | Promise<Uint8Array | undefined> {
    const res = this.input.get(this.next);
    if (res instanceof Promise) {
      return res.then(line => {
        if (line) { this.current = Math.max(this.current, this.next); this.next++; }
        return line;
      });
    }
    if (res) { this.current = Math.max(this.current, this.next); this.next++; }
    return res;
  }
  private range(pattern: Pattern, repetition: bigint): CsplitError {
    return new CsplitError(`${this.matcher.budget.quote(String(pattern.line))}: line number out of range${repetition ? ` on repetition ${repetition}` : ""}`);
  }
  private async first(): Promise<void> {
    if (!await this.input.get(this.next)) throw new CsplitError("input disappeared", false, true);
  }
  private async rest(): Promise<void> {
    for (;;) {
      const r = this.remove();
      const line = r instanceof Promise ? await r : r;
      if (line === undefined) break;
      const w = this.output.write(line);
      if (w) await w;
      { const cp = this.matcher.budget.checkpointWork(); if (cp) await cp; }
    }
  }
  private async numeric(pattern: Pattern, repetition: bigint): Promise<void> {
    const target = BigInt.asUintN(64, pattern.line! * (repetition + 1n));
    await this.output.open();
    if (this.output.options.suppress && !await this.input.get(this.current + 1)) throw this.range(pattern, repetition);
    await this.first();
    while (BigInt(this.next) < target) {
      const r = this.remove();
      const line = r instanceof Promise ? await r : r;
      if (!line) throw this.range(pattern, repetition);
      const w = this.output.write(line);
      if (w) await w;
      { const cp = this.matcher.budget.checkpointWork(); if (cp) await cp; }
    }
    await this.output.finish();
    if (!this.output.options.suppress && !await this.input.get(this.current + 1)) throw this.range(pattern, repetition);
  }
  private async regex(pattern: Pattern, repetition: bigint): Promise<boolean> {
    if (!pattern.ignore) await this.output.open();
    for (;;) {
      const rLine = this.input.get(++this.current);
      const line = rLine instanceof Promise ? await rLine : rLine;
      if (!line) {
        if (!pattern.forever) {
          const message = `${this.matcher.budget.quote(pattern.argument)}: match not found${repetition ? ` on repetition ${repetition}` : ""}`;
          if (!pattern.ignore) await this.rest();
          throw new CsplitError(message);
        }
        if (!pattern.ignore) { await this.rest(); await this.output.finish(); }
        return true;
      }
      const subject = line.at(-1) === 10 ? line.subarray(0, -1) : line;
      if (await this.matcher.search(pattern.expression!, subject)) break;
      if (pattern.offset >= 0n) {
        const rRem = this.remove();
        const removed = rRem instanceof Promise ? await rRem : rRem;
        if (removed && !pattern.ignore) { const w = this.output.write(removed); if (w) await w; }
      }
      { const cp = this.matcher.budget.checkpointWork(); if (cp) await cp; }
    }
    const target = BigInt.asUintN(64, BigInt(this.current) + pattern.offset);
    await this.first();
    if (BigInt(this.next) > target) throw new CsplitError(`${this.matcher.budget.quote(pattern.argument)}: line number out of range`);
    while (BigInt(this.next) < target) {
      const r = this.remove();
      const line = r instanceof Promise ? await r : r;
      if (!line) throw new CsplitError(`${this.matcher.budget.quote(pattern.argument)}: line number out of range`);
      if (!pattern.ignore) { const w = this.output.write(line); if (w) await w; }
      { const cp = this.matcher.budget.checkpointWork(); if (cp) await cp; }
    }
    if (!pattern.ignore) await this.output.finish();
    if (pattern.offset > 0n) this.current = Number(target);
    return false;
  }
  async run(patterns: readonly Pattern[]): Promise<void> {
    for (const pattern of patterns) {
      for (let repetition = 0n; pattern.forever || repetition <= pattern.repeat; repetition++) {
        this.matcher.budget.charge();
        if (pattern.expression !== undefined) {
          if (await this.regex(pattern, repetition)) return;
        } else await this.numeric(pattern, repetition);
        if (this.output.options.suppress) await this.remove();
        { const cp = this.matcher.budget.checkpointWork(); if (cp) await cp; }
      }
    }
    await this.output.open();
    await this.rest();
    await this.output.finish();
  }
}
