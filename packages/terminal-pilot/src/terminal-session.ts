import { EventEmitter } from "node:events";
import { accessSync, chmodSync, constants } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as nodePty from "node-pty";
import { stripAnsi } from "./ansi.js";
import { hasOwnErrorCode } from "./errors.js";
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
const CLOSE_AFTER_SIGKILL_MS = 1000;

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
  private closePromise: Promise<number> | null = null;

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
    assertTerminalGeometry(cols, rows);
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
      throw new Error(`Terminal session "${this.id}" has already exited.`);
    }

    this.pty.write(raw);
  }

  async signal(sig: string): Promise<void> {
    if (this.exitCode !== null) {
      return;
    }

    this.pty.kill(sig);
  }

  async waitFor(pattern: string | RegExp, opts?: WaitForOptions): Promise<string> {
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    assertTimeout(timeout);
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeout) {
      const matched = matchPattern(this.rawBuffer, pattern);
      if (matched !== null) {
        return matched;
      }

      if (this.exitCode !== null) {
        throw new Error(`Terminal session "${this.id}" exited before matching pattern: ${String(pattern)}`);
      }

      await sleep(WAIT_FOR_POLL_MS);
    }

    throw new Error(`Timed out waiting for pattern after ${timeout}ms: ${String(pattern)}`);
  }

  async waitForQuiet(ms: number): Promise<void> {
    assertQuietPeriod(ms);
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

    if (!Number.isInteger(opts.last) || opts.last < 0) {
      throw new Error("History last must be a non-negative integer.");
    }

    const start = Math.max(0, lines.length - opts.last);
    return lines.slice(start);
  }

  async resize(cols: number, rows: number): Promise<void> {
    assertTerminalGeometry(cols, rows);
    this.currentCols = cols;
    this.currentRows = rows;
    if (this.exitCode === null) {
      this.pty.resize(cols, rows);
    }
    this.terminal.resize(cols, rows);
  }

  async waitForExit(opts?: { timeout?: number }): Promise<number> {
    if (opts?.timeout !== undefined) {
      assertTimeout(opts.timeout);
    }

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

    this.closePromise ??= this.closeProcess().catch((error: unknown) => {
      this.closePromise = null;
      throw error;
    });
    return this.closePromise;
  }

  private async closeProcess(): Promise<number> {
    const gracefulExitCode = await waitForExit(this.exitPromise, CLOSE_AFTER_SIGNAL_GRACE_MS);
    if (gracefulExitCode !== null) {
      return gracefulExitCode;
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
      const afterSigkill = await waitForExit(this.exitPromise, CLOSE_AFTER_SIGKILL_MS);
      if (afterSigkill !== null) {
        return afterSigkill;
      }
    }

    throw new Error("Timed out waiting for process to exit after SIGKILL.");
  }

  on(event: "exit", cb: (code: number) => void): void {
    this.emitter.on(event, cb);
  }
}

function assertTerminalGeometry(cols: number, rows: number): void {
  if (!Number.isInteger(cols) || cols <= 0 || !Number.isInteger(rows) || rows <= 0) {
    throw new Error("Terminal columns and rows must be positive integers.");
  }
}

function assertTimeout(timeout: number): void {
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new Error("Timeout must be a finite non-negative number.");
  }
}

function assertQuietPeriod(duration: number): void {
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error("Quiet period must be a finite non-negative number.");
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
  ensureSpawnHelperExecutable();
  return nodePty.spawn(command, args, {
    cwd,
    env,
    cols,
    rows,
    encoding: "utf8"
  });
}

let spawnHelperChecked = false;

function ensureSpawnHelperExecutable(): void {
  if (spawnHelperChecked) return;
  spawnHelperChecked = true;

  const require = createRequire(import.meta.url);
  const nodePtyDir = dirname(require.resolve("node-pty"));
  const helper = join(nodePtyDir, "..", "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");

  try {
    accessSync(helper, constants.X_OK);
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }

    try {
      chmodSync(helper, 0o755);
    } catch (chmodError) {
      if (isMissingFileError(chmodError)) {
        return;
      }

      throw chmodError;
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
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
  let line = "";
  let cursor = 0;

  for (const character of input) {
    if (character === "\r") {
      cursor = 0;
      continue;
    }

    if (character === "\b") {
      cursor = Math.max(0, cursor - 1);
      continue;
    }

    if (character === "\n") {
      output += `${line}\n`;
      line = "";
      cursor = 0;
      continue;
    }

    line = `${line.slice(0, cursor)}${character}${line.slice(cursor + 1)}`;
    cursor += 1;
  }

  return output + line;
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
