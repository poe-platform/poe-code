import { CsplitError } from "./internal.js";
import { Lines, Outputs } from "./io.js";
import { Matcher, type Pattern } from "./patterns.js";

export class Splitter {
  private next = 1;
  private current = 0;
  constructor(readonly input: Lines, readonly output: Outputs, readonly matcher: Matcher) {}
  private async remove(): Promise<Uint8Array | undefined> {
    const line = await this.input.get(this.next);
    if (line) { this.current = Math.max(this.current, this.next); this.next++; }
    return line;
  }
  private range(pattern: Pattern, repetition: bigint): CsplitError {
    return new CsplitError(`${this.matcher.budget.quote(String(pattern.line))}: line number out of range${repetition ? ` on repetition ${repetition}` : ""}`);
  }
  private async first(): Promise<void> {
    if (!await this.input.get(this.next)) throw new CsplitError("input disappeared", false, true);
  }
  private async rest(): Promise<void> {
    let line: Uint8Array | undefined;
    while ((line = await this.remove()) !== undefined) {
      await this.output.write(line);
      await this.matcher.budget.checkpointWork();
    }
  }
  private async numeric(pattern: Pattern, repetition: bigint): Promise<void> {
    const target = BigInt.asUintN(64, pattern.line! * (repetition + 1n));
    await this.output.open();
    if (this.output.options.suppress && !await this.input.get(this.current + 1)) throw this.range(pattern, repetition);
    await this.first();
    while (BigInt(this.next) < target) {
      const line = await this.remove();
      if (!line) throw this.range(pattern, repetition);
      await this.output.write(line);
      await this.matcher.budget.checkpointWork();
    }
    await this.output.finish();
    if (this.output.options.suppress) await this.remove();
    else if (!await this.input.get(this.current + 1)) throw this.range(pattern, repetition);
  }
  private async regex(pattern: Pattern, repetition: bigint): Promise<boolean> {
    if (!pattern.ignore) await this.output.open();
    if (this.output.options.suppress && this.current > 0) await this.remove();
    for (;;) {
      const line = await this.input.get(++this.current);
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
        const removed = await this.remove();
        if (removed && !pattern.ignore) await this.output.write(removed);
      }
      await this.matcher.budget.checkpointWork();
    }
    const target = BigInt.asUintN(64, BigInt(this.current) + pattern.offset);
    await this.first();
    if (BigInt(this.next) > target) throw new CsplitError(`${this.matcher.budget.quote(pattern.argument)}: line number out of range`);
    while (BigInt(this.next) < target) {
      const line = await this.remove();
      if (!line) throw new CsplitError(`${this.matcher.budget.quote(pattern.argument)}: line number out of range`);
      if (!pattern.ignore) await this.output.write(line);
      await this.matcher.budget.checkpointWork();
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
        await this.matcher.budget.checkpointWork();
      }
    }
    await this.output.open();
    await this.rest();
    await this.output.finish();
  }
}
