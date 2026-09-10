import { Budget, PrError, PrReadError } from "./internal.js";
import { Lifecycle, Reader } from "./io.js";
import type { Options } from "./options.js";

interface StoredLine { text: string; end: number }
interface Column {
  reader: Reader;
  status: "open" | "held" | "feed" | "closed";
  full: boolean;
  numbered: boolean;
  start: number;
  lines: StoredLine[];
  current: number;
  remaining: number;
}

export class Formatter {
  private readonly budget: Budget;
  private readonly body: number;
  private readonly columnWidth: number;
  private readonly numberWidth: number;
  private readonly store: boolean;
  private columns: Column[] = [];
  private lineNumber: number;
  private pageNumber = 1;
  private inputPosition = 0;
  private outputPosition = 0;
  private spaces = 0;
  private separators = 0;
  private padding = 0;
  private vertical = false;
  private empty = true;
  private alignEmpty = false;
  private feedOnly = false;
  private printFeed = false;
  private needHeader = false;
  private storing = false;
  private stored = "";
  private rendered = "";
  private pageRetained = 0;

  constructor(private readonly options: Options, private readonly lifecycle: Lifecycle, count: number) {
    this.budget = lifecycle.budget;
    if (options.length <= 10) { options.extremities = false; options.keepFF = true; }
    this.body = Math.floor((options.extremities ? options.length - 10 : options.length) / (options.doubleSpace ? 2 : 1));
    if (this.body < 1) throw new PrError("page has no text lines");
    options.columns = options.merge ? count : options.columns;
    if (options.columns > 1) {
      if (!options.useSeparator) { options.useSeparator = true; options.separator = options.join ? "\t" : " "; }
      else if (!options.join && options.separator === "\t") options.separator = " ";
      options.truncate = true;
      options.tabify = true;
    }
    if (options.join) options.truncate = false;
    this.numberWidth = options.numberSeparator === "\t" ? options.digits + 8 - options.digits % 8 : options.digits + 1;
    this.columnWidth = Math.trunc((options.width - (options.merge && options.numbered ? this.numberWidth : 0) - (options.columns - 1) * options.separator.length) / options.columns);
    if (this.columnWidth < 1) throw new PrError("page width too narrow");
    this.store = options.columns > 1 && !options.merge && !options.across;
    this.lineNumber = options.startNumber;
    lifecycle.cleanup(async () => {
      this.budget.retain(-this.pageRetained - this.rendered.length * 2);
      this.pageRetained = 0;
      this.rendered = "";
      this.columns = [];
    });
  }

  private append(value: string): void {
    this.budget.charge(value.length);
    this.budget.retain(value.length * 2);
    this.rendered += value;
  }
  private repeat(value: string, count: number, construction = false): string {
    this.budget.admitString(value.length * count);
    if (construction) this.budget.charge(value.length * count);
    return value.repeat(count);
  }
  private async flush(): Promise<void> {
    const text = this.rendered;
    this.rendered = "";
    this.budget.retain(-text.length * 2);
    if (text) await this.lifecycle.write(text);
  }
  private white(): void {
    let position = this.outputPosition;
    const goal = position + this.spaces;
    this.budget.check(Math.max(0, this.spaces), this.budget.limits.maxBufferedBytes, "horizontal padding");
    while (goal - position > 1) {
      const next = position + this.options.outputTabWidth - position % this.options.outputTabWidth;
      if (next > goal) break;
      this.append(this.options.outputTab);
      position = next;
    }
    if (goal > position) this.append(this.repeat(" ", goal - position));
    this.outputPosition = goal;
    this.spaces = 0;
  }
  private pad(position: number): void {
    if (this.options.tabify) this.spaces = position - this.outputPosition;
    else {
      if (position > this.outputPosition) this.append(this.repeat(" ", position - this.outputPosition));
      this.outputPosition = position;
    }
  }
  private separator(): void {
    if (this.separators <= 0) { if (this.spaces > 0) this.white(); return; }
    let offset = 0;
    for (; this.separators > 0; this.separators--) {
      while (offset < this.options.separator.length) {
        const character = this.options.separator[offset++]!;
        if (character === " ") this.spaces++;
        else { if (this.spaces > 0) this.white(); this.append(character); this.outputPosition++; }
      }
      if (this.spaces > 0) this.white();
    }
  }
  private character(character: string): void {
    if (this.storing) {
      this.budget.charge(character.length);
      this.budget.retain(character.length * 2);
      this.pageRetained += character.length * 2;
      this.stored += character;
      return;
    }
    if (this.options.tabify) {
      if (character === " ") { this.spaces++; return; }
      if (this.spaces > 0) this.white();
      if (character >= " " && character <= "~") this.outputPosition++;
      else if (character === "\b") this.outputPosition--;
    }
    this.append(character);
  }
  private number(column: Column): void {
    this.budget.admitString(this.options.digits);
    const text = String(this.lineNumber++).padStart(this.options.digits, " ").slice(-this.options.digits);
    for (const character of text) this.character(character);
    if (this.columns.length > 1 && this.options.numberSeparator === "\t") {
      for (let count = this.numberWidth - this.options.digits; count > 0; count--) this.character(" ");
    } else {
      this.character(this.options.numberSeparator);
      if (this.columns.length === 1 && this.options.numberSeparator === "\t") this.outputPosition += this.options.outputTabWidth - this.outputPosition % this.options.outputTabWidth;
    }
    if (this.options.truncate && !this.options.merge) this.inputPosition += this.numberWidth;
    this.budget.charge(column.numbered ? 1 : 0);
  }
  private align(column: Column): void {
    this.padding = column.start;
    if (this.options.separator.length < this.padding) { this.pad(this.padding - this.options.separator.length); this.padding = 0; }
    if (this.options.useSeparator) this.separator();
    if (column.numbered) this.number(column);
  }
  private clump(byte: number): string {
    const character = String.fromCharCode(byte);
    let width: number;
    let text = character;
    if (character === this.options.inputTab || byte === 9) {
      const tab = character === this.options.inputTab ? this.options.inputTabWidth : 8;
      width = tab - this.inputPosition % tab;
      if (this.options.expand) text = this.repeat(" ", width, true);
    } else if (byte < 32 || byte > 126) {
      if (this.options.octal || this.options.control && byte >= 128) { text = `\\${byte.toString(8).padStart(3, "0")}`; width = 4; }
      else if (this.options.control) { text = `^${String.fromCharCode(byte ^ 64)}`; width = 2; }
      else width = byte === 8 ? -1 : 0;
    } else width = 1;
    if (width < 0 && this.inputPosition === 0) return "";
    this.inputPosition = Math.max(0, this.inputPosition + width);
    return text;
  }
  private close(column: Column): void {
    for (const current of this.options.merge ? [column] : this.columns) {
      current.status = "closed";
      if (!current.lines.length) current.remaining = 0;
    }
  }
  private hold(column: Column): void {
    for (const current of this.options.merge ? [column] : this.columns) current.status = this.store ? "feed" : "held";
    column.remaining = 0;
  }
  private async feed(column: Column): Promise<void> {
    const next = await column.reader.get();
    if (next !== 10) column.reader.unget(next);
    this.hold(column);
  }
  private async rest(column: Column): Promise<void> {
    for (;;) {
      const byte = await column.reader.get();
      if (byte === 10) return;
      if (byte === 12) { await this.feed(column); if (this.options.keepFF) this.printFeed = true; return; }
      if (byte < 0) { this.close(column); return; }
    }
  }
  private header(date: string, name: string): void {
    const { env } = this.budget.context;
    if (![undefined, "", "UTC", "UTC0", ":UTC", "GMT", "GMT0"].includes(env.TZ)) throw new PrError("only UTC timezones are supported for headers");
    const ctype = env.LC_ALL || env.LC_CTYPE || env.LANG || "C";
    if (ctype === "C.UTF-8" || ctype === "C.utf8") {
      for (const character of name) if (character.charCodeAt(0) >= 128) throw new PrError("non-ASCII headers require the C locale");
    }
    this.outputPosition = 0;
    this.pad(this.options.margin);
    this.white();
    const width = (text: string): number => {
      this.budget.charge(text.length);
      let result = 0;
      for (const character of text) if (character >= " " && character !== "\x7f") result++;
      return result;
    };
    const page = `Page ${this.pageNumber}`;
    const available = Math.max(0, this.options.width - width(date) - width(name) - width(page));
    const left = Math.floor(available / 2);
    this.budget.admitString(5 + this.options.margin + date.length + name.length + page.length + Math.max(1, left) + Math.max(1, available - left));
    this.append(`\n\n${this.repeat(" ", this.options.margin)}${date}${this.repeat(" ", Math.max(1, left))}${name}${this.repeat(" ", Math.max(1, available - left))}${page}\n\n\n`);
    this.needHeader = false;
    this.outputPosition = 0;
  }
  private async read(column: Column, date: string, name: string): Promise<void> {
    let byte = await column.reader.get();
    if (byte === 12 && column.full) { byte = await column.reader.get(); if (byte === 10) byte = await column.reader.get(); }
    column.full = false;
    if (byte === 12) {
      await this.feed(column);
      this.feedOnly = true;
      if (this.needHeader && !this.store) { this.vertical = true; this.header(date, name); }
      else if (this.options.keepFF) this.printFeed = true;
      return;
    }
    if (byte < 0) { this.close(column); return; }
    let clump = byte === 10 ? "" : this.clump(byte);
    if (this.options.truncate && this.inputPosition > this.columnWidth) { this.inputPosition = 0; await this.rest(column); return; }
    if (!this.storing) {
      this.vertical = true;
      if (this.needHeader && !this.store) this.header(date, name);
      if (this.options.merge && this.alignEmpty) {
        const pending = this.separators;
        this.separators = 0;
        for (let index = 0; index < pending; index++) { this.align(this.columns[index]!); this.separators++; }
        this.padding = column.start;
        this.spaces = this.options.truncate ? this.columnWidth : 0;
        this.alignEmpty = false;
      }
      if (this.options.separator.length < this.padding) { this.pad(this.padding - this.options.separator.length); this.padding = 0; }
      if (this.options.useSeparator) this.separator();
    }
    if (column.numbered) this.number(column);
    this.empty = false;
    if (byte === 10) return;
    for (const character of clump) this.character(character);
    for (;;) {
      byte = await column.reader.get();
      if (byte === 10) return;
      if (byte === 12) { await this.feed(column); if (this.options.keepFF) this.printFeed = true; return; }
      if (byte < 0) { this.close(column); return; }
      const previous = this.inputPosition;
      clump = this.clump(byte);
      if (this.options.truncate && this.inputPosition > this.columnWidth) { this.inputPosition = previous; await this.rest(column); return; }
      for (const character of clump) this.character(character);
    }
  }
  private ready(): boolean {
    return this.columns.some(column => column.status === "open" || column.status === "feed" || this.store && column.remaining > 0 && column.lines.length > 0);
  }
  private async storePage(date: string, name: string): Promise<void> {
    this.budget.retain(-this.pageRetained);
    this.pageRetained = 0;
    const lines: StoredLine[] = [];
    this.storing = true;
    for (const column of this.columns) { column.lines = []; column.current = 0; }
    try {
      for (const column of this.columns) {
        for (let count = 0; count < this.body && column.status === "open"; count++) {
          this.stored = "";
          this.inputPosition = 0;
          await this.read(column, date, name);
          if (column.status === "open" || this.stored.length) {
            this.budget.retain(32);
            this.pageRetained += 32;
            lines.push({ text: this.stored, end: this.inputPosition });
          }
        }
      }
    } finally { this.storing = false; }
    let start = 0;
    for (let index = 0; index < this.columns.length; index++) {
      const column = this.columns[index]!;
      const count = Math.floor(lines.length / this.columns.length) + (index < lines.length % this.columns.length ? 1 : 0);
      column.lines = lines.slice(start, start + count);
      column.remaining = count;
      start += count;
    }
  }
  private storedLine(column: Column, date: string, name: string): void {
    this.vertical = true;
    if (this.needHeader) this.header(date, name);
    if (column.status === "feed") {
      for (const current of this.columns) current.status = "held";
      if (this.columns[0]!.remaining <= 0) { if (!this.options.extremities) this.vertical = false; return; }
    }
    const line = column.lines[column.current++];
    if (!line) return;
    if (this.options.separator.length < this.padding) { this.pad(this.padding - this.options.separator.length); this.padding = 0; }
    if (this.options.useSeparator) this.separator();
    for (const character of line.text) this.character(character);
    if (this.spaces === 0) {
      this.outputPosition = column.start + line.end;
      if (column.start - this.options.separator.length === this.options.margin) this.outputPosition -= this.options.separator.length;
    }
  }
  async run(readers: Reader[], date: string, name: string): Promise<void> {
    const count = this.options.merge ? readers.length : this.options.columns;
    for (let index = 0; index < count; index++) {
      const start = index === 0 ? this.options.margin + this.options.separator.length : this.options.truncate
        ? this.options.margin + index * (this.columnWidth + this.options.separator.length) + (this.options.merge && this.options.numbered ? this.numberWidth : 0) : 0;
      this.columns.push({ reader: readers[this.options.merge ? index : 0]!, status: "open", full: false,
        numbered: this.options.numbered && (!this.options.merge || index === 0), start,
        lines: [], current: 0, remaining: 0 });
    }
    try { await this.pages(date, name); }
    catch (error) { if (error instanceof PrReadError) await this.flush(); throw error; }
  }
  private async pages(date: string, name: string): Promise<void> {
    for (;;) {
      if (this.store) await this.storePage(date, name);
      else for (const column of this.columns) column.remaining = column.status === "open" ? this.body : 0;
      if (!this.ready()) return;
      this.budget.page();
      this.needHeader = this.options.extremities;
      let printed = false;
      let left = this.body * (this.options.doubleSpace ? 2 : 1);
      while (left > 0 && this.ready()) {
        this.outputPosition = 0; this.spaces = 0; this.separators = 0; this.vertical = false; this.alignEmpty = false; this.empty = true;
        for (const column of this.columns) {
          this.budget.charge();
          this.inputPosition = 0;
          if (column.remaining > 0 || column.status === "feed") {
            this.feedOnly = false;
            this.padding = column.start;
            if (this.store) this.storedLine(column, date, name);
            else await this.read(column, date, name);
            printed ||= this.vertical;
            column.remaining--;
            if (column.remaining <= 0 && !this.ready()) break;
            if (this.options.merge && column.status !== "open") {
              if (this.empty) this.alignEmpty = true;
              else if (column.status === "closed" || this.feedOnly) this.align(column);
            }
          } else if (this.options.merge) { if (this.empty) this.alignEmpty = true; else this.align(column); }
          if (this.options.useSeparator) this.separators++;
        }
        if (this.vertical) { this.append("\n"); left--; }
        if (!this.ready() && !this.options.extremities) { await this.flush(); break; }
        if (this.options.doubleSpace && printed) { this.append("\n"); left--; }
        await this.flush();
      }
      if (left === 0) for (const column of this.columns) if (column.status === "open") column.full = true;
      if (printed && this.options.extremities) this.append(this.options.formFeed ? "\f" : this.repeat("\n", left + 5));
      else if (this.options.keepFF && this.printFeed) { this.append("\f"); this.printFeed = false; }
      await this.flush();
      this.pageNumber++;
      for (const column of this.columns) if (column.status === "held") column.status = "open";
    }
  }
}
