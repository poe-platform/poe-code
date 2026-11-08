import type { TerminalDriver, TerminalInputEvent } from "../terminal/driver.js";

export class FakeTerminalDriver implements TerminalDriver {
  readonly writes: string[] = [];
  started = false;
  startCount = 0;
  stopCount = 0;
  private readonly eventHandlers = new Set<(event: TerminalInputEvent) => void>();
  private readonly resizeHandlers = new Set<(size: { cols: number; rows: number }) => void>();

  constructor(private cols = 120, private rows = 24) {}
  get output(): string { return this.writes.join(""); }
  get destroyed(): boolean { return !this.started && this.stopCount > 0; }
  get altScreen(): boolean { return this.started; }
  get enterAltScreenCount(): number { return this.startCount; }

  start(): void { if (!this.started) { this.started = true; this.startCount += 1; } }
  stop(): void { if (this.started) { this.started = false; this.stopCount += 1; } }
  onEvent(handler: (event: TerminalInputEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => { this.eventHandlers.delete(handler); };
  }
  onResize(handler: (size: { cols: number; rows: number }) => void): () => void {
    this.resizeHandlers.add(handler);
    return () => { this.resizeHandlers.delete(handler); };
  }
  getSize(): { cols: number; rows: number } { return { cols: this.cols, rows: this.rows }; }
  writeFrame(ansi: string): void { if (this.started) this.writes.push(ansi); }
  resize(cols: number, rows: number): void {
    this.cols = cols; this.rows = rows;
    for (const handler of this.resizeHandlers) handler(this.getSize());
  }
  press(key: { name?: string; ch?: string; ctrl: boolean; meta: boolean; shift: boolean }): void {
    if (!this.started) return;
    const event: TerminalInputEvent = { type: "key", name: key.name ?? key.ch ?? "", ch: key.ch, ctrl: key.ctrl, alt: key.meta, shift: key.shift };
    for (const handler of this.eventHandlers) handler(event);
  }
}
