import { createInputParser, type TerminalInputEvent } from "./input.js";
import { createFrameWriter } from "./output.js";

export interface Size { cols: number; rows: number }

export interface TerminalDriver {
  start(): void;
  stop(): void;
  onEvent(fn: (event: TerminalInputEvent) => void): () => void;
  onResize(fn: (size: Size) => void): () => void;
  getSize(): Size;
  writeFrame(ansi: string): void;
}

interface InputStream {
  setRawMode?: (enabled: boolean) => void;
  resume(): void;
  pause(): void;
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  off(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

interface OutputStream {
  columns?: number;
  rows?: number;
  write(value: string): boolean;
  on(event: "resize", listener: () => void): unknown;
  off(event: "resize", listener: () => void): unknown;
}

export function createTerminalDriver(options: {
  input?: InputStream;
  output?: OutputStream;
  escTimeoutMs?: number;
} = {}): TerminalDriver {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const eventListeners = new Set<(event: TerminalInputEvent) => void>();
  const resizeListeners = new Set<(size: Size) => void>();
  const emit = (event: TerminalInputEvent) => {
    for (const listener of eventListeners) listener(event);
  };
  const parser = createInputParser({ escTimeoutMs: options.escTimeoutMs, onEvent: emit });
  const writer = createFrameWriter(output);
  let started = false;

  const onData = (chunk: Buffer | string) => {
    for (const event of parser.feed(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))) emit(event);
  };
  const getSize = (): Size => ({ cols: dimension(output.columns), rows: dimension(output.rows) });
  const onTerminalResize = () => {
    const size = getSize();
    for (const listener of resizeListeners) listener(size);
  };

  return {
    start() {
      if (started) return;
      started = true;
      input.setRawMode?.(true);
      input.resume();
      input.on("data", onData);
      output.on("resize", onTerminalResize);
      writer.open();
    },
    stop() {
      if (!started) return;
      started = false;
      input.off("data", onData);
      output.off("resize", onTerminalResize);
      parser.destroy();
      writer.close();
      input.setRawMode?.(false);
      input.pause();
    },
    onEvent(fn) {
      eventListeners.add(fn);
      return () => { eventListeners.delete(fn); };
    },
    onResize(fn) {
      resizeListeners.add(fn);
      return () => { resizeListeners.delete(fn); };
    },
    getSize,
    writeFrame: writer.writeFrame
  };
}

function dimension(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
}

export type { TerminalInputEvent } from "./input.js";
