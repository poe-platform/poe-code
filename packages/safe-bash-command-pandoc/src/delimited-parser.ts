import {PandocError} from "./errors.js";
import type {AdapterContext} from "./types.js";

export interface DelimitedEvents {
  text?(text: string): Promise<void>;
  field?(): Promise<void>;
  record?(): Promise<void>;
}

/** Incremental CSV/TSV grammar. Fields and rows can exceed the working buffer. */
export class DelimitedParser {
  rows = 0;
  width = 0;
  private fields = 0;
  private fieldLength = 0;
  private pending = "";
  private state: "start" | "plain" | "quoted" | "closed" = "start";
  private active = false;
  private line = 1;
  private column = 1;
  private work = 0;
  constructor(readonly format: "csv" | "tsv", private readonly context: AdapterContext, private readonly events: DelimitedEvents = {}, private readonly accountBudgets = true) {}

  private fail(message: string): never {
    throw new PandocError("E_PARSE", "read", message, this.format, `${this.line}:${this.column}`);
  }
  private append(char: string): void {
    this.context.bound("tableFieldText", this.fieldLength + char.length);
    if (this.accountBudgets) this.context.charge("retainedBytes", char.length * 2);
    this.fieldLength += char.length;
    if (this.events.text) this.pending += char;
  }
  private async flush(): Promise<void> {
    if (!this.pending) return;
    const text = this.pending;
    this.pending = "";
    await this.events.text!(text);
  }
  private async endField(): Promise<void> {
    this.context.bound("tableColumns", this.fields + 1);
    if (this.accountBudgets) this.context.charge("references", 1);
    await this.flush();
    await this.events.field?.();
    this.fields++;
    this.fieldLength = 0;
    this.state = "start";
  }
  private async endRecord(): Promise<void> {
    this.context.bound("tableRows", this.rows + 1);
    await this.endField();
    this.width = Math.max(this.width, this.fields);
    this.context.bound("tableCells", (this.rows + 1) * this.width);
    if (this.accountBudgets) this.context.charge("references", 1);
    await this.events.record?.();
    this.rows++;
    this.fields = 0;
    this.active = false;
  }
  async accept(text: string): Promise<void> {
    const delimiter = this.format === "csv" ? "," : "\t";
    for (const char of text) {
      this.context.checkpoint();
      this.context.bound("tableRows", this.rows + 1);
      this.context.bound("tableColumns", this.fields + 1);
      this.active = true;
      if (this.state === "quoted") {
        if (char === '"') this.state = "closed";
        else this.append(char);
      } else if (this.state === "closed" && char === '"') {
        this.append('"'); this.state = "quoted";
      } else if (char === delimiter) {
        this.context.bound("tableColumns", this.fields + 2);
        this.context.bound("tableCells", (this.rows + 1) * Math.max(this.width, this.fields + 2));
        await this.endField();
      } else if (char === "\n") await this.endRecord();
      else if (this.format === "csv" && char === '"' && this.state === "start") this.state = "quoted";
      else {
        if (this.format === "csv" && (char === '"' || this.state === "closed")) this.fail("CSV quotes must enclose the entire field");
        this.append(char); this.state = "plain";
      }
      if (char === "\n") {this.line++; this.column = 1;}
      else this.column++;
      if (this.pending.length >= 4096) await this.flush();
      if (++this.work % 256 === 0) await this.context.cooperate(0);
    }
  }
  async finish(): Promise<void> {
    if (this.state === "quoted") this.fail("Unterminated quoted CSV field");
    if (this.active) await this.endRecord();
  }
}
