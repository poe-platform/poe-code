import { spawn } from "node:child_process";
import {
  mkdirSync
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { renderTerminalPng } from "terminal-png";

export function stripLeadingDashes(value: string): string {
  let cleaned = value;
  while (cleaned.startsWith("-")) {
    cleaned = cleaned.slice(1);
  }
  return cleaned;
}

export function normalizeArg(value: string): string {
  const withoutDashes = stripLeadingDashes(value);
  if (!withoutDashes) {
    return "";
  }

  let normalized = "";
  let previousWasDash = false;

  for (const char of withoutDashes) {
    const code = char.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    const isSafe = isDigit || isUpper || isLower || char === "." || char === "_";

    if (isSafe) {
      normalized += char;
      previousWasDash = false;
      continue;
    }

    if (!previousWasDash) {
      normalized += "-";
      previousWasDash = true;
    }
  }

  if (normalized.startsWith("-")) {
    normalized = normalized.slice(1);
  }
  if (normalized.endsWith("-")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function buildScreenshotName(args: string[]): string {
  const normalized = args
    .map((arg) => normalizeArg(arg))
    .filter((arg) => arg.length > 0);
  if (normalized.length === 0) {
    return "screenshot";
  }
  return normalized.join("-");
}

export function buildScreenshotOutputPath(args: string[]): string {
  return path.posix.join(
    "screenshots",
    `${buildScreenshotName(args)}.png`
  );
}


type ScreenshotTarget = {
  prepare?: {
    command: string;
    args: string[];
  };
  command: string;
  args: string[];
  nameArgs: string[];
  displayCommand: string;
  displayArgs: string[];
  forceTty: boolean;
};

export function resolveScreenshotTarget(args: string[]): ScreenshotTarget {
  const [first, ...rest] = args;
  if (first === "--poe-code") {
    return {
      prepare: {
        command: "npm",
        args: ["run", "--silent", "predev"]
      },
      command: "npm",
      args: ["run", "--silent", "--ignore-scripts", "dev", "--", ...rest],
      nameArgs: rest,
      displayCommand: "poe-code",
      displayArgs: rest,
      forceTty: true
    };
  }
  if (!first) {
    throw new Error("Provide a command to screenshot.");
  }
  return {
    command: first,
    args: rest,
    nameArgs: args,
    displayCommand: first,
    displayArgs: rest,
    forceTty: false
  };
}

function escapeQuotes(value: string): string {
  return value.split('"').join('\\"');
}

function formatArgForDisplay(value: string): string {
  if (value.includes(" ") || value.includes("\t")) {
    return `"${escapeQuotes(value)}"`;
  }
  return value;
}

export function buildCommandHeader(
  command: string,
  args: string[]
): string {
  const parts = [command, ...args]
    .filter((part) => part.length > 0)
    .map((part) => formatArgForDisplay(part));
  return `% ${parts.join(" ")}\n`;
}

export function sanitizeOutputChunk(chunk: string): string {
  let result = "";
  for (const char of chunk) {
    const code = char.charCodeAt(0);
    if (code === 8) {
      result += "\u001b[D";
      continue;
    }
    if (
      code === 9 ||
      code === 10 ||
      code === 13 ||
      code === 27 ||
      code >= 32
    ) {
      result += char;
    }
  }
  return result;
}

const DEFAULT_SCREENSHOT_TIMEOUT_MS = 60000;

export function resolveScreenshotTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.POE_SCREENSHOT_TIMEOUT_MS;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DEFAULT_SCREENSHOT_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SCREENSHOT_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

function resolvePositiveInteger(value: string | undefined, fallback: number): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

type SpawnSpec = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

type PseudoTerminalSession = {
  exitCode: number | null;
  send(raw: string): Promise<void>;
  screen(): Promise<{ rawLines: readonly string[] }>;
  waitForExit(opts?: { timeout?: number }): Promise<number>;
  close(): Promise<number>;
};

type PseudoTerminalPilot = {
  newSession(opts: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string | undefined>;
    cols: number;
    rows: number;
  }): Promise<PseudoTerminalSession>;
  close(): Promise<void>;
};

const screenshotKeyTokens: Record<string, string> = {
  up: "\u001b[A",
  down: "\u001b[B",
  left: "\u001b[D",
  right: "\u001b[C",
  "shift-up": "\u001b[1;2A",
  "shift-down": "\u001b[1;2B",
  tab: "\t",
  enter: "\r",
  return: "\r",
  escape: "\u001b",
  esc: "\u001b",
  space: " ",
  "ctrl-p": "\u0010",
  "ctrl-k": "\u000b",
  "ctrl-f": "\u0006",
  "ctrl-b": "\u0002"
};

export function decodeScreenshotKeys(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }

  const keys: string[] = [];
  for (const token of value.split(",")) {
    keys.push(...decodeScreenshotKeyToken(token.trim()));
  }
  return keys;
}

export function usePtyScreenshot(env: NodeJS.ProcessEnv): boolean {
  return env.POE_SCREENSHOT_PTY === "1";
}

export function shouldUsePtyScreenshot(
  target: ScreenshotTarget,
  env: NodeJS.ProcessEnv
): boolean {
  if (usePtyScreenshot(env)) {
    return true;
  }
  if (!target.forceTty) {
    return false;
  }
  return !target.displayArgs.includes("--yes") && !target.displayArgs.includes("--help");
}

function decodeScreenshotKeyToken(token: string): string[] {
  if (token.length === 0) {
    return [];
  }

  const repeatSeparator = token.lastIndexOf("*");
  const keyToken = repeatSeparator === -1 ? token : token.slice(0, repeatSeparator);
  const repeatRaw = repeatSeparator === -1 ? "1" : token.slice(repeatSeparator + 1);
  const repeat = Number.parseInt(repeatRaw, 10);
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error(`Invalid screenshot key repeat "${token}".`);
  }

  const key =
    screenshotKeyTokens[keyToken] ??
    (Array.from(keyToken).length === 1 ? keyToken : undefined);
  if (key === undefined) {
    throw new Error(`Unknown screenshot key token "${keyToken}".`);
  }

  return Array.from({ length: repeat }, () => key);
}

export function buildColorEnv(
  baseEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    FORCE_COLOR: "1",
    CLICOLOR_FORCE: "1",
    POE_NO_SPINNER: "1"
  };
  if (!env.NPM_CONFIG_LOGLEVEL) {
    env.NPM_CONFIG_LOGLEVEL = "silent";
  }
  if (!env.TERM) {
    env.TERM = "xterm-256color";
  }
  if (Object.prototype.hasOwnProperty.call(env, "NO_COLOR")) {
    delete env.NO_COLOR;
  }
  return env;
}

export function buildSpawnSpec(
  target: ScreenshotTarget,
  baseEnv: NodeJS.ProcessEnv,
  forceTtyPath: string
): SpawnSpec {
  const env = buildColorEnv(baseEnv);
  let args = target.args;
  if (
    target.command === "npm" &&
    args[0] === "run" &&
    !args.includes("--silent")
  ) {
    args = ["run", "--silent", ...args.slice(1)];
  }
  if (target.forceTty) {
    const requireFlag = `--require ${forceTtyPath}`;
    env.NODE_OPTIONS = env.NODE_OPTIONS
      ? `${env.NODE_OPTIONS} ${requireFlag}`
      : requireFlag;
  }
  return {
    command: target.command,
    args,
    env
  };
}

export function createTimeout(
  timeoutMs: number,
  onTimeout: () => void
): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let isDone = false;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (isDone) {
        return;
      }
      isDone = true;
      onTimeout();
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return {
    promise,
    cancel: () => {
      if (isDone) {
        return;
      }
      isDone = true;
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
}

function waitForExit(
  child: ReturnType<typeof spawn>
): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (typeof code === "number") {
        resolve(code);
        return;
      }
      resolve(1);
    });
  });
}

export type ScreenshotOptions = {
  output?: string;
  header?: boolean;
};

export async function runScreenshot(
  commandArgs: string[],
  options: ScreenshotOptions
): Promise<void> {
  const target = resolveScreenshotTarget(commandArgs);
  const screenshotKeys = decodeScreenshotKeys(process.env.POE_SCREENSHOT_KEYS);
  const forceTtyPath = fileURLToPath(
    new URL("./force-tty.cjs", import.meta.url)
  );
  const spawnSpec = buildSpawnSpec(target, process.env, forceTtyPath);
  const outputPath =
    options.output ?? buildScreenshotOutputPath(target.nameArgs);
  mkdirSync(path.dirname(outputPath), { recursive: true });

  if (target.prepare) {
    const prepareProcess = spawn(target.prepare.command, target.prepare.args, {
      stdio: "inherit",
      env: buildColorEnv(process.env)
    });
    const prepareCode = await waitForExit(prepareProcess);
    if (prepareCode !== 0) {
      const label = [target.prepare.command, ...target.prepare.args].join(" ");
      throw new Error(`${label} exited with code ${prepareCode}`);
    }
  }

  const usePty = shouldUsePtyScreenshot(target, process.env);
  if (usePty) {
    await runPtyScreenshot({
      target,
      spawnSpec,
      outputPath,
      options,
      screenshotKeys,
      captureDelayMs: usePtyScreenshot(process.env)
        ? undefined
        : resolvePositiveInteger(process.env.POE_SCREENSHOT_CAPTURE_DELAY_MS, 7000)
    });
    return;
  }

  const commandProcess = spawn(spawnSpec.command, spawnSpec.args, {
    stdio: [screenshotKeys.length > 0 ? "pipe" : "ignore", "pipe", "pipe"],
    env: spawnSpec.env
  });
  if (!commandProcess.stdout || !commandProcess.stderr) {
    throw new Error("Unable to capture command output.");
  }

  const capturedChunks: string[] = [];
  commandProcess.stdout.on("data", (chunk) => {
    capturedChunks.push(sanitizeOutputChunk(String(chunk)));
  });
  commandProcess.stderr.on("data", (chunk) => {
    capturedChunks.push(sanitizeOutputChunk(String(chunk)));
  });
  const cancelInput = scheduleScreenshotKeys(commandProcess, screenshotKeys, process.env);

  const timeoutMs = resolveScreenshotTimeoutMs(process.env);
  const timeout = createTimeout(timeoutMs, () => {
    if (!commandProcess.killed) {
      commandProcess.kill("SIGTERM");
    }
  });

  let commandCode: number;
  let timedOut = false;
  try {
    commandCode = (await Promise.race([
      waitForExit(commandProcess),
      timeout.promise
    ])) as number;
  } catch {
    timedOut = true;
    commandCode = 1;
  } finally {
    cancelInput();
    timeout.cancel();
  }

  const header =
    options.header !== false
      ? buildCommandHeader(target.displayCommand, target.displayArgs)
      : "";
  const transcript = `${header}${capturedChunks.join("")}`;

  await renderTerminalPng(transcript, {
    padding: 20,
    window: true,
    output: outputPath
  });

  process.stdout.write(`${outputPath}\n`);

  if (timedOut) {
    process.stderr.write(`Timed out after ${timeoutMs}ms — screenshot saved with captured output\n`);
  } else if (commandCode !== 0) {
    const label = [target.command, ...target.args].join(" ");
    process.stderr.write(`${label} exited with code ${commandCode} — screenshot saved\n`);
  }
}

async function runPtyScreenshot(opts: {
  target: ScreenshotTarget;
  spawnSpec: SpawnSpec;
  outputPath: string;
  options: ScreenshotOptions;
  screenshotKeys: readonly string[];
  captureDelayMs?: number;
}): Promise<void> {
  const { TerminalPilot } = await import("terminal-pilot");
  const pilot = await (TerminalPilot as { launch(): Promise<PseudoTerminalPilot> }).launch();
  const size = resolvePtySize(process.env);
  const timeoutMs = resolveScreenshotTimeoutMs(process.env);
  let commandCode = 0;
  let timedOut = false;

  try {
    const session = await pilot.newSession({
      command: opts.spawnSpec.command,
      args: opts.spawnSpec.args,
      cwd: process.cwd(),
      env: opts.spawnSpec.env,
      cols: size.cols,
      rows: size.rows
    });

    const cancelInput = schedulePtyScreenshotKeys(session, opts.screenshotKeys, process.env);
    try {
      if (opts.captureDelayMs !== undefined) {
        await sleep(opts.captureDelayMs);
      } else {
        commandCode = await session.waitForExit({ timeout: timeoutMs });
      }
    } catch {
      timedOut = true;
      commandCode = session.exitCode ?? 1;
    } finally {
      cancelInput();
    }

    const screen = await session.screen();
    const header =
      opts.options.header !== false
        ? buildCommandHeader(opts.target.displayCommand, opts.target.displayArgs)
        : "";
    await renderTerminalPng(`${header}${screen.rawLines.join("\n")}`, {
      padding: 20,
      window: true,
      output: opts.outputPath
    });

    await session.close();
  } finally {
    await pilot.close();
  }

  process.stdout.write(`${opts.outputPath}\n`);

  if (timedOut) {
    process.stderr.write(`Timed out after ${timeoutMs}ms — screenshot saved with captured output\n`);
  } else if (commandCode !== 0) {
    const label = [opts.target.command, ...opts.target.args].join(" ");
    process.stderr.write(`${label} exited with code ${commandCode} — screenshot saved\n`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolvePtySize(env: NodeJS.ProcessEnv): { cols: number; rows: number } {
  return {
    cols: resolvePositiveInteger(env.POE_SCREENSHOT_COLUMNS, 120),
    rows: resolvePositiveInteger(env.POE_SCREENSHOT_ROWS, 40)
  };
}

function schedulePtyScreenshotKeys(
  session: Pick<PseudoTerminalSession, "send" | "exitCode">,
  keys: readonly string[],
  env: NodeJS.ProcessEnv
): () => void {
  if (keys.length === 0) {
    return () => {};
  }

  const initialDelayMs = resolvePositiveInteger(env.POE_SCREENSHOT_KEY_DELAY_MS, 250);
  const intervalMs = resolvePositiveInteger(env.POE_SCREENSHOT_KEY_INTERVAL_MS, 75);
  const timers: Array<ReturnType<typeof setTimeout>> = [];

  keys.forEach((key, index) => {
    timers.push(setTimeout(() => {
      if (session.exitCode === null) {
        void session.send(key);
      }
    }, initialDelayMs + intervalMs * index));
  });

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
  };
}

function scheduleScreenshotKeys(
  child: ReturnType<typeof spawn>,
  keys: readonly string[],
  env: NodeJS.ProcessEnv
): () => void {
  if (keys.length === 0 || child.stdin === null) {
    return () => {};
  }

  const initialDelayMs = resolvePositiveInteger(env.POE_SCREENSHOT_KEY_DELAY_MS, 250);
  const intervalMs = resolvePositiveInteger(env.POE_SCREENSHOT_KEY_INTERVAL_MS, 75);
  const timers: Array<ReturnType<typeof setTimeout>> = [];

  keys.forEach((key, index) => {
    timers.push(setTimeout(() => {
      if (!child.killed) {
        child.stdin?.write(key);
      }
    }, initialDelayMs + intervalMs * index));
  });

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
  };
}

const entry = process.argv[1];
const isMain =
  typeof entry === "string" &&
  path.resolve(entry) === fileURLToPath(import.meta.url);
if (isMain) {
  const program = new Command();
  program
    .argument("[command...]", "Command to screenshot")
    .option("-o, --output <path>", "Output file path")
    .option("--no-header", "Skip command header in output")
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments()
    .action((commandArgs: string[], options: ScreenshotOptions) => {
      runScreenshot(commandArgs, options).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      });
    });
  program.parse();
}
