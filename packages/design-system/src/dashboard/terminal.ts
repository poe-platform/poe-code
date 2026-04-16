import readline from "node:readline";
import { PassThrough } from "node:stream";
import { cellToAnsi } from "./buffer.js";
import type { Cell } from "./types.js";

export type KeypressEvent = {
  name?: string;
  ch?: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
};

export type TerminalDriver = {
  enterRawMode(): void;
  exitRawMode(): void;
  enterAltScreen(): void;
  exitAltScreen(): void;
  hideCursor(): void;
  showCursor(): void;
  moveTo(x: number, y: number): void;
  write(text: string): void;
  flush(changes: Array<{ x: number; y: number; cell: Cell }>): void;
  getSize(): { cols: number; rows: number };
  onResize(handler: () => void): () => void;
  onKeypress(handler: (key: KeypressEvent) => void): () => void;
  destroy(): void;
};

type ReadlineKey = {
  sequence?: string;
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
};

type KeypressInput = NodeJS.ReadableStream & {
  on(event: "keypress", listener: (str: string | undefined, key: ReadlineKey) => void): KeypressInput;
  off(event: "keypress", listener: (str: string | undefined, key: ReadlineKey) => void): KeypressInput;
};

type TerminalInput = NodeJS.ReadStream & KeypressInput & {
  setRawMode?: (mode: boolean) => void;
};

type TerminalOutput = NodeJS.WriteStream & {
  columns?: number;
  rows?: number;
  on(event: "resize", listener: () => void): TerminalOutput;
  off(event: "resize", listener: () => void): TerminalOutput;
};

export function createTerminalDriver(opts?: {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}): TerminalDriver {
  const stdin = (opts?.stdin ?? process.stdin) as TerminalInput;
  const stdout = (opts?.stdout ?? process.stdout) as TerminalOutput;
  const resizeListeners = new Set<() => void>();
  const keypressListeners = new Set<(str: string | undefined, key: ReadlineKey) => void>();
  let rawMode = false;
  let altScreen = false;
  let cursorHidden = false;
  let destroyed = false;

  readline.emitKeypressEvents(stdin);

  function enterRawMode(): void {
    if (destroyed || rawMode) {
      return;
    }

    stdin.setRawMode?.(true);
    stdin.resume();
    rawMode = true;
  }

  function exitRawMode(): void {
    if (destroyed || !rawMode) {
      return;
    }

    stdin.setRawMode?.(false);
    stdin.pause();
    rawMode = false;
  }

  function enterAltScreen(): void {
    if (destroyed || altScreen) {
      return;
    }

    write("\u001b[?1049h");
    altScreen = true;
  }

  function exitAltScreen(): void {
    if (destroyed || !altScreen) {
      return;
    }

    write("\u001b[?1049l");
    altScreen = false;
  }

  function hideCursor(): void {
    if (destroyed || cursorHidden) {
      return;
    }

    write("\u001b[?25l");
    cursorHidden = true;
  }

  function showCursor(): void {
    if (destroyed || !cursorHidden) {
      return;
    }

    write("\u001b[?25h");
    cursorHidden = false;
  }

  function moveTo(x: number, y: number): void {
    if (destroyed) {
      return;
    }

    write(cursorPositionAnsi(x, y));
  }

  function write(text: string): void {
    if (destroyed || text.length === 0) {
      return;
    }

    stdout.write(text);
  }

  function flush(changes: Array<{ x: number; y: number; cell: Cell }>): void {
    if (destroyed || changes.length === 0) {
      return;
    }

    let output = "";

    for (const change of changes) {
      output += `${cursorPositionAnsi(change.x, change.y)}${cellToAnsi(change.cell)}`;
    }

    write(output);
  }

  function getSize(): { cols: number; rows: number } {
    return {
      cols: normalizeSize(stdout.columns),
      rows: normalizeSize(stdout.rows)
    };
  }

  function onResize(handler: () => void): () => void {
    if (destroyed) {
      return () => {};
    }

    const listener = () => {
      handler();
    };

    resizeListeners.add(listener);
    stdout.on("resize", listener);

    return () => {
      if (!resizeListeners.delete(listener)) {
        return;
      }

      stdout.off("resize", listener);
    };
  }

  function onKeypress(handler: (key: KeypressEvent) => void): () => void {
    if (destroyed) {
      return () => {};
    }

    const listener = (str: string | undefined, key: ReadlineKey) => {
      const event = toKeypressEvent(str, key);
      if (event !== undefined) {
        handler(event);
      }
    };

    keypressListeners.add(listener);
    stdin.on("keypress", listener);

    return () => {
      if (!keypressListeners.delete(listener)) {
        return;
      }

      stdin.off("keypress", listener);
    };
  }

  function destroy(): void {
    if (destroyed) {
      return;
    }

    for (const listener of keypressListeners) {
      stdin.off("keypress", listener);
    }
    keypressListeners.clear();

    for (const listener of resizeListeners) {
      stdout.off("resize", listener);
    }
    resizeListeners.clear();

    exitRawMode();
    exitAltScreen();
    showCursor();
    destroyed = true;
  }

  return {
    enterRawMode,
    exitRawMode,
    enterAltScreen,
    exitAltScreen,
    hideCursor,
    showCursor,
    moveTo,
    write,
    flush,
    getSize,
    onResize,
    onKeypress,
    destroy
  };
}

export function parseKeypress(data: Buffer): KeypressEvent | undefined {
  if (data.length === 0) {
    return undefined;
  }

  const stream = new PassThrough();
  const stdin = stream as unknown as KeypressInput;
  let event: KeypressEvent | undefined;

  readline.emitKeypressEvents(stdin);
  stdin.on("keypress", (str, key) => {
    event = toKeypressEvent(str, key);
  });
  stream.emit("data", data);
  stream.destroy();

  return event;
}

function toKeypressEvent(str: string | undefined, key: ReadlineKey | undefined): KeypressEvent | undefined {
  const ctrl = key?.ctrl ?? false;
  const meta = key?.meta ?? false;
  const shift = key?.shift ?? false;
  const ch = extractPrintableCharacter(str, key?.sequence);

  if (ch !== undefined) {
    return { ch, ctrl, meta, shift };
  }

  if (key?.name === undefined) {
    return undefined;
  }

  return {
    name: key.name,
    ctrl,
    meta,
    shift
  };
}

function extractPrintableCharacter(str: string | undefined, sequence: string | undefined): string | undefined {
  if (isPrintableCharacter(str)) {
    return str;
  }

  if (sequence === undefined || sequence.length <= 1 || sequence[0] !== "\u001b") {
    return undefined;
  }

  const candidate = sequence.slice(1);
  return isPrintableCharacter(candidate) ? candidate : undefined;
}

function isPrintableCharacter(value: string | undefined): value is string {
  if (value === undefined || Array.from(value).length !== 1) {
    return false;
  }

  const codePoint = value.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0x20 && codePoint !== 0x7f;
}

function cursorPositionAnsi(x: number, y: number): string {
  return `\u001b[${normalizeCoordinate(y) + 1};${normalizeCoordinate(x) + 1}H`;
}

function normalizeCoordinate(value: number): number {
  return Math.max(0, Math.floor(value));
}

function normalizeSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}
