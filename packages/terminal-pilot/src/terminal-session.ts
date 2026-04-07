import { spawn as spawnChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import * as nodePty from "node-pty";
import { stripAnsi } from "./ansi.js";
import { TerminalBuffer } from "./terminal-buffer.js";
import { keyToSequence, type TerminalKey } from "./keys.js";
import { TerminalScreen } from "./terminal-screen.js";

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;
const DEFAULT_TIMEOUT_MS = 10_000;
const WAIT_FOR_POLL_MS = 10;
const TYPE_DELAY_MS = 15;
const CLOSE_AFTER_SIGNAL_GRACE_MS = 250;
const CLOSE_AFTER_SIGTERM_MS = 1000;

type TerminalSessionOptions = {
  id: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  cols?: number;
  rows?: number;
  observe?: boolean;
};

export type WaitForOptions = {
  timeout?: number;
};

export type HistoryOptions = {
  last?: number;
};

type PtyLike = {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (chunk: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
};

export class TerminalSession {
  readonly id: string;
  readonly command: string;
  readonly pid: number;
  exitCode: number | null = null;

  private readonly pty: PtyLike;
  private readonly terminal: TerminalBuffer;
  private readonly emitter = new EventEmitter();
  private readonly exitPromise: Promise<number>;
  private rawBuffer = "";
  private lastDataAt = Date.now();
  private currentCols: number;
  private currentRows: number;
  private closeRequested = false;
  private signalRequested = false;

  constructor({
    id,
    command,
    args = [],
    cwd = process.cwd(),
    env = process.env,
    cols = DEFAULT_COLS,
    rows = DEFAULT_ROWS,
    observe = false
  }: TerminalSessionOptions) {
    this.id = id;
    this.command = command;
    this.currentCols = cols;
    this.currentRows = rows;
    this.terminal = new TerminalBuffer(cols, rows);
    this.pty = createPtyProcess({ command, args, cwd, env, cols, rows });
    this.pid = this.pty.pid;

    const dataSubscription = this.pty.onData((chunk) => {
      this.rawBuffer += chunk;
      this.lastDataAt = Date.now();
      this.terminal.write(chunk);

      if (observe) {
        process.stderr.write(chunk);
      }
    });

    let exitSubscription: { dispose(): void } | undefined;

    this.exitPromise = new Promise<number>((resolve) => {
      exitSubscription = this.pty.onExit(({ exitCode }) => {
        if (this.exitCode !== null) {
          resolve(this.exitCode);
          return;
        }

        this.exitCode = exitCode;
        dataSubscription.dispose();
        exitSubscription?.dispose();
        this.emitter.emit("exit", exitCode);
        resolve(exitCode);
      });
    });
  }

  async type(text: string): Promise<void> {
    for (const character of text) {
      await this.send(character);
      await sleep(TYPE_DELAY_MS);
    }
  }

  async fill(text: string): Promise<void> {
    await this.send(text.replace(/\r?\n/g, "\r"));
  }

  async press(key: TerminalKey): Promise<void> {
    await this.send(keyToSequence(key));
  }

  async send(raw: string): Promise<void> {
    if (this.exitCode !== null) {
      return;
    }

    this.pty.write(raw);
  }

  async signal(sig: string): Promise<void> {
    if (this.exitCode !== null) {
      return;
    }

    this.signalRequested = true;
    this.pty.kill(sig);
  }

  async waitFor(pattern: string | RegExp, opts?: WaitForOptions): Promise<string> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeout) {
      const matched = matchPattern(this.rawBuffer, pattern);
      if (matched !== null) {
        return matched;
      }

      await sleep(WAIT_FOR_POLL_MS);
    }

    throw new Error(`Timed out waiting for pattern after ${timeout}ms: ${String(pattern)}`);
  }

  async waitForQuiet(ms: number): Promise<void> {
    while (true) {
      const remaining = ms - (Date.now() - this.lastDataAt);
      if (remaining <= 0) {
        return;
      }

      await sleep(remaining);
    }
  }

  async screen(): Promise<TerminalScreen> {
    const rawLines: string[] = [];

    for (let row = 0; row < this.currentRows; row += 1) {
      rawLines.push(this.terminal.renderLine(row));
    }

    return new TerminalScreen({
      lines: rawLines,
      rawLines,
      cursor: {
        row: this.terminal.displayBuffer.cursorY,
        col: this.terminal.displayBuffer.cursorX
      },
      size: {
        rows: this.currentRows,
        cols: this.currentCols
      }
    });
  }

  async history(opts?: HistoryOptions): Promise<string[]> {
    const normalized = normalizeHistoryBuffer(stripAnsi(this.rawBuffer));
    const lines = splitHistoryLines(normalized);

    if (opts?.last === undefined) {
      return lines;
    }

    const start = Math.max(0, lines.length - opts.last);
    return lines.slice(start);
  }

  async resize(cols: number, rows: number): Promise<void> {
    this.currentCols = cols;
    this.currentRows = rows;
    if (this.exitCode === null) {
      this.pty.resize(cols, rows);
    }
    this.terminal.resize(cols, rows);
  }

  async waitForExit(opts?: { timeout?: number }): Promise<number> {
    if (this.exitCode !== null) {
      return this.exitCode;
    }

    if (opts?.timeout !== undefined) {
      const result = await waitForExit(this.exitPromise, opts.timeout);
      if (result === null) {
        throw new Error(`Timed out waiting for process to exit after ${opts.timeout}ms`);
      }
      return result;
    }

    return this.exitPromise;
  }

  async close(): Promise<number> {
    if (this.exitCode !== null) {
      return this.exitCode;
    }

    if (!this.closeRequested) {
      this.closeRequested = true;

      const gracefulExitCode = await waitForExit(this.exitPromise, CLOSE_AFTER_SIGNAL_GRACE_MS);
      if (gracefulExitCode !== null) {
        return gracefulExitCode;
      }

      if (this.signalRequested) {
        return this.exitPromise;
      }

      if (this.exitCode === null) {
        this.pty.kill("SIGTERM");
        const afterSigterm = await waitForExit(this.exitPromise, CLOSE_AFTER_SIGTERM_MS);
        if (afterSigterm !== null) {
          return afterSigterm;
        }
      }

      if (this.exitCode === null) {
        this.pty.kill("SIGKILL");
      }
    }

    return this.exitPromise;
  }

  on(event: "exit", cb: (code: number) => void): void {
    this.emitter.on(event, cb);
  }
}

function createPtyProcess({
  command,
  args,
  cwd,
  env,
  cols,
  rows
}: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  cols: number;
  rows: number;
}): PtyLike {
  try {
    return nodePty.spawn(command, args, {
      cwd,
      env,
      cols,
      rows,
      encoding: "utf8"
    });
  } catch {
    return createChildProcessFallback({ command, args, cwd, env });
  }
}

function createChildProcessFallback({
  command,
  args,
  cwd,
  env
}: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}): PtyLike {
  const child = spawnChildProcess(command, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  return new ChildProcessFallback(child);
}

class ChildProcessFallback implements PtyLike {
  readonly pid: number;

  private readonly child: ChildProcessWithoutNullStreams;
  private readonly dataEmitter = new EventEmitter();
  private readonly exitEmitter = new EventEmitter();

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    this.pid = child.pid ?? -1;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", this.handleData);
    child.stderr.on("data", this.handleData);
    child.on("exit", (exitCode, signal) => {
      this.exitEmitter.emit("exit", {
        exitCode: exitCode ?? signalToExitCode(signal),
        signal: undefined
      });
    });
  }

  write(data: string): void {
    this.child.stdin.write(data);
  }

  resize(): void {
    // No-op in fallback mode.
  }

  kill(signal?: string): void {
    this.child.kill(signal as NodeJS.Signals | undefined);
  }

  onData(listener: (chunk: string) => void): { dispose(): void } {
    this.dataEmitter.on("data", listener);

    return {
      dispose: () => {
        this.dataEmitter.off("data", listener);
      }
    };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitEmitter.on("exit", listener);

    return {
      dispose: () => {
        this.exitEmitter.off("exit", listener);
      }
    };
  }

  private readonly handleData = (chunk: string | Buffer) => {
    this.dataEmitter.emit("data", String(chunk));
  };
}

function signalToExitCode(signal: NodeJS.Signals | null): number {
  if (signal === null) {
    return 0;
  }

  const signalNumbers: Partial<Record<NodeJS.Signals, number>> = {
    SIGTERM: 15,
    SIGINT: 2,
    SIGHUP: 1,
    SIGKILL: 9
  };

  const signalNumber = signalNumbers[signal];
  if (signalNumber === undefined) {
    return 1;
  }

  return 128 + signalNumber;
}

function matchPattern(buffer: string, pattern: string | RegExp): string | null {
  const clean = normalizeHistoryBuffer(stripAnsi(buffer));

  for (const line of clean.split("\n")) {
    if (typeof pattern === "string") {
      if (line.includes(pattern)) return line;
    } else {
      const flags = removeCharacter(pattern.flags, "g");
      if (new RegExp(pattern.source, flags).test(line)) return line;
    }
  }

  return null;
}

function removeCharacter(input: string, charToRemove: string): string {
  let output = "";

  for (const character of input) {
    if (character !== charToRemove) {
      output += character;
    }
  }

  return output;
}


function splitHistoryLines(input: string): string[] {
  const lines = input.split("\n");

  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function normalizeHistoryBuffer(input: string): string {
  let output = "";

  for (const character of input) {
    if (character === "\r" || character === "\b") {
      continue;
    }

    output += character;
  }

  return output;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForExit(exitPromise: Promise<number>, timeout: number): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(null);
    }, timeout);

    void exitPromise.then((code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(code);
    });
  });
}
