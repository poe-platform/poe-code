import { writeBytes, type CommandContext } from "../../contracts/index.js";
import { writeFileOutput } from "../../contracts/filesystem-output.js";
import { AwkArray, type Value } from "./awk-values.js";
import { Budget, ProgramError, bytes, virtualPath } from "./shared.js";
import type { Statement } from "./awk-syntax.js";
import { quoteAwk } from "./awk-quote.js";

export interface AwkInspectionOptions {
  dump?: string;
  profile?: string;
  trace?: boolean;
}

export class AwkInspection {
  private readonly counts = new Map<Statement["kind"], number>();
  constructor(private readonly context: CommandContext, private readonly budget: Budget, private readonly options: AwkInspectionOptions) {}

  async observe(statement: Statement, phase: string): Promise<void> {
    if (this.options.profile !== undefined) this.counts.set(statement.kind, (this.counts.get(statement.kind) ?? 0) + 1);
    if (this.options.trace) {
      const entry = `+ safe-bash awk ${phase} ${statement.kind}\n`;
      await writeBytes(this.context.stderr, bytes(this.budget.check(entry)), this.context.signal);
    }
  }

  async publish(variables: ReadonlyMap<string, Value>): Promise<void> {
    if (this.options.dump !== undefined) {
      let output = "";
      for (const name of [...variables.keys()].sort()) {
        this.budget.step();
        const value = variables.get(name)!;
        const display = value instanceof AwkArray ? `array, ${value.entries.size} elements`
          : value.kind === "number" ? String(value.number) : value.kind === "unset" ? '""' : quoteAwk(value.text, this.budget);
        const entry = `${name}: ${display}\n`;
        if (output.length + entry.length > this.budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
        output += entry;
      }
      await this.save(this.options.dump, output);
    }
    if (this.options.profile !== undefined) {
      let output = "# safe-bash awk statement profile (aggregate execution counts)\n";
      for (const [kind, count] of this.counts) output = this.budget.check(output + `${count}\t${kind}\n`);
      await this.save(this.options.profile, this.budget.check(output));
    }
  }

  private async save(destination: string, output: string): Promise<void> {
    const path = virtualPath(this.context, destination);
    await writeFileOutput(this.context, bytes(output), chunk => this.context.fs.writeFile(path, chunk, { signal: this.context.signal }));
  }
}
