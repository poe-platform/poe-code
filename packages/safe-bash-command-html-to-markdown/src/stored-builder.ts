import { utf8ByteLength } from "safe-bash-byte-engine";
import type { Budget } from "./budget.js";
import type { TextStore, TextBuilder } from "./stored-text.js";

/** Rendering limits apply before appending either shared text or literal bytes. */
export class StoredBuilder {
  private readonly builder: TextBuilder;
  private size = 0;
  private tail = "";
  constructor(private readonly text: TextStore, private readonly budget: Budget, private readonly maximum = budget.limits.maxOutputBytes - budget.output) {
    this.builder = text.builder();
  }
  get empty(): boolean { return this.size === 0; }
  get trailingSpace(): boolean { return this.tail.endsWith(" "); }
  get blockBoundary(): boolean { return this.empty || this.tail.endsWith("\n"); }
  async write(value: string): Promise<void> {
    if (!value) return;
    const bytes = utf8ByteLength(value);
    this.budget.check(bytes, this.maximum - this.size, "rendered bytes");
    this.budget.work(value.length);
    await this.builder.write(value);
    this.size += bytes;
    this.tail = (this.tail + value.slice(-2)).slice(-2);
  }
  async append(root: number): Promise<void> {
    if (!root) return;
    const info = await this.text.info(root);
    this.budget.check(info.bytes, this.maximum - this.size, "rendered bytes");
    this.budget.work(info.length);
    await this.builder.append(root);
    this.size += info.bytes;
    const last = await this.text.at(root, -1);
    this.tail = info.length === 1 ? (this.tail + last).slice(-2) : (await this.text.at(root, -2))! + last;
  }
  async separate(): Promise<void> {
    if (!this.empty) await this.write(this.tail.endsWith("\n\n") ? "" : this.tail.endsWith("\n") ? "\n" : "\n\n");
  }
  /** Suspend/resume without charging already-appended output a second time. */
  snapshot(): Promise<number> { return this.builder.finish(); }
  async restore(root: number): Promise<void> {
    await this.builder.append(root);
    this.size = (await this.text.info(root)).bytes;
    this.tail = ((await this.text.at(root, -2)) ?? "") + ((await this.text.at(root, -1)) ?? "");
  }
  async finish(): Promise<number> {
    this.budget.work(this.size);
    return this.builder.finish();
  }
}
