import type { Cell } from "../dashboard/types.js";
import type { KeypressEvent, TerminalDriver } from "../dashboard/terminal.js";

export class FakeTerminalDriver implements TerminalDriver {
  readonly keyQueue: KeypressEvent[] = [];
  readonly writes: string[] = [];
  readonly flushes: Array<Array<{ x: number; y: number; cell: Cell }>> = [];
  rawMode = false;
  altScreen = false;
  lineWrap = true;
  cursorVisible = true;
  destroyed = false;
  enterAltScreenCount = 0;
  exitAltScreenCount = 0;
  enterRawModeCount = 0;
  exitRawModeCount = 0;
  private readonly keypressHandlers = new Set<(key: KeypressEvent) => void>();
  private readonly resizeHandlers = new Set<() => void>();

  constructor(
    private cols = 120,
    private rows = 24
  ) {}

  get output(): string {
    return this.writes.join("");
  }

  enterRawMode(): void {
    this.rawMode = true;
    this.enterRawModeCount += 1;
  }

  exitRawMode(): void {
    this.rawMode = false;
    this.exitRawModeCount += 1;
  }

  enterAltScreen(): void {
    this.altScreen = true;
    this.enterAltScreenCount += 1;
  }

  exitAltScreen(): void {
    this.altScreen = false;
    this.exitAltScreenCount += 1;
  }

  disableLineWrap(): void {
    this.lineWrap = false;
  }

  enableLineWrap(): void {
    this.lineWrap = true;
  }

  hideCursor(): void {
    this.cursorVisible = false;
  }

  showCursor(): void {
    this.cursorVisible = true;
  }

  moveTo(x: number, y: number): void {
    this.write(`\u001b[${Math.max(1, y + 1)};${Math.max(1, x + 1)}H`);
  }

  write(text: string): void {
    if (!this.destroyed) {
      this.writes.push(text);
    }
  }

  flush(changes: Array<{ x: number; y: number; cell: Cell }>): void {
    this.flushes.push(changes);
  }

  getSize(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    for (const handler of this.resizeHandlers) {
      handler();
    }
  }

  onResize(handler: () => void): () => void {
    this.resizeHandlers.add(handler);
    return () => {
      this.resizeHandlers.delete(handler);
    };
  }

  onKeypress(handler: (key: KeypressEvent) => void): () => void {
    this.keypressHandlers.add(handler);
    return () => {
      this.keypressHandlers.delete(handler);
    };
  }

  press(key: KeypressEvent): void {
    this.keyQueue.push(key);
    for (const handler of this.keypressHandlers) {
      handler(key);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.rawMode = false;
    this.lineWrap = true;
    this.altScreen = false;
    this.cursorVisible = true;
    this.keypressHandlers.clear();
    this.resizeHandlers.clear();
  }
}
