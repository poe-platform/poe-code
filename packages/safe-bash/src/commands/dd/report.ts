import type { CommandContext } from "../../contracts/command.js";
import { writeBytes } from "../../contracts/io.js";
import type { DdPlan } from "./options.js";

export interface DdStatistics {
  inputFull: bigint;
  inputPartial: bigint;
  outputFull: bigint;
  outputPartial: bigint;
  truncated: bigint;
  bytes: bigint;
}

function human(value: number, base: number): string {
  let exponent = 0;
  while (value >= base && exponent < 10) { value /= base; exponent++; }
  if (Math.round(value) >= base && exponent < 10) { value /= base; exponent++; }
  const tenths = Math.round(value * 10);
  const number = exponent > 0 && tenths < 100 ? (tenths / 10).toFixed(1) : Math.round(value).toString();
  const unit = exponent === 0 ? "B" : `${(base === 1000 ? "kMGTPEZYRQ" : "KMGTPEZYRQ")[exponent - 1]}${base === 1024 ? "i" : ""}B`;
  return `${number} ${unit}`;
}

export function transferReport(bytes: bigint, elapsedMs: number, progress = false): string {
  const seconds = Math.max(0, elapsedMs) / 1000;
  const size = Number(bytes);
  const decimal = human(size, 1000), binary = human(size, 1024);
  const suffix = size < 1000 ? "" : size < 1024 ? ` (${decimal})` : ` (${decimal}, ${binary})`;
  const rounded = Number(seconds.toPrecision(6));
  let elapsed = progress ? Math.round(seconds).toString() : rounded.toString();
  if (!progress && rounded && (rounded < 0.0001 || rounded >= 1000000)) {
    const [significand, exponent] = rounded.toExponential().split("e");
    const power = Number(exponent);
    elapsed = `${significand}e${power < 0 ? "-" : "+"}${Math.abs(power).toString().padStart(2, "0")}`;
  }
  const rate = seconds > 0 ? `${human(size / seconds, 1000)}/s` : "Infinity B/s";
  return `${bytes} ${bytes === 1n ? "byte" : "bytes"}${suffix} copied, ${elapsed} s, ${rate}`;
}

export class DdReporter {
  readonly stats: DdStatistics = { inputFull: 0n, inputPartial: 0n, outputFull: 0n, outputPartial: 0n, truncated: 0n, bytes: 0n };
  private readonly start: number;
  private next = 1000;
  private progressLength = 0;

  constructor(private readonly context: CommandContext, private readonly status: DdPlan["status"], private readonly now: () => number) {
    this.start = now();
  }

  async progress(): Promise<void> {
    if (this.status !== "progress") return;
    const elapsed = this.now() - this.start;
    if (elapsed < this.next) return;
    this.next += 1000;
    const line = transferReport(this.stats.bytes, elapsed, true);
    await writeBytes(this.context.stderr, new TextEncoder().encode(`\r${line}${" ".repeat(Math.max(0, this.progressLength - line.length))}`), this.context.signal);
    this.progressLength = line.length;
  }

  async report(): Promise<void> {
    if (this.status === "none") return;
    let text = this.progressLength ? "\n" : "";
    this.progressLength = 0;
    text += `${this.stats.inputFull}+${this.stats.inputPartial} records in\n${this.stats.outputFull}+${this.stats.outputPartial} records out\n`;
    if (this.stats.truncated) text += `${this.stats.truncated} truncated record${this.stats.truncated === 1n ? "" : "s"}\n`;
    if (this.status !== "noxfer") text += `${transferReport(this.stats.bytes, this.now() - this.start)}\n`;
    await writeBytes(this.context.stderr, new TextEncoder().encode(text), this.context.signal);
  }
}
