import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Transform } from "node:stream";
import { Command } from "commander";

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
  return withoutDashes.split(" ").join("-");
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
      command: "npm",
      args: ["run", "dev", "--silent", "--", ...rest],
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

const DEFAULT_SCREENSHOT_TIMEOUT_MS = 5000;

export function resolveScreenshotTimeoutMs(
  env: NodeJS.ProcessEnv
): number {
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

function createSanitizer(): Transform {
  return new Transform({
    transform(chunk, _encoding, callback) {
      const text = Buffer.isBuffer(chunk)
        ? chunk.toString("utf8")
        : String(chunk);
      this.push(sanitizeOutputChunk(text));
      callback();
    }
  });
}

function pipeSanitized(
  source: NodeJS.ReadableStream,
  destination: NodeJS.WritableStream
): void {
  const sanitizer = createSanitizer();
  source.pipe(sanitizer);
  sanitizer.pipe(destination, { end: false });
}

type SpawnSpec = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

export function buildColorEnv(
  baseEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    FORCE_COLOR: "1",
    CLICOLOR_FORCE: "1",
    POE_NO_SPINNER: "1"
  };
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
  if (target.forceTty) {
    const requireFlag = `--require ${forceTtyPath}`;
    env.NODE_OPTIONS = env.NODE_OPTIONS
      ? `${env.NODE_OPTIONS} ${requireFlag}`
      : requireFlag;
  }
  return {
    command: target.command,
    args: target.args,
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
  const forceTtyPath = fileURLToPath(
    new URL("./force-tty.cjs", import.meta.url)
  );
  const spawnSpec = buildSpawnSpec(target, process.env, forceTtyPath);
  const outputPath =
    options.output ?? buildScreenshotOutputPath(target.nameArgs);
  mkdirSync(path.dirname(outputPath), { recursive: true });

  const commandProcess = spawn(spawnSpec.command, spawnSpec.args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: spawnSpec.env
  });
  const freezeProcess = spawn(
    "freeze",
    ["-o", outputPath, "--window", "--padding", "20", "--language", "ansi"],
    { stdio: ["pipe", "inherit", "inherit"] }
  );

  if (
    !commandProcess.stdout ||
    !commandProcess.stderr ||
    !freezeProcess.stdin
  ) {
    throw new Error("Unable to pipe command output into freeze.");
  }

  if (options.header !== false) {
    freezeProcess.stdin.write(
      buildCommandHeader(target.displayCommand, target.displayArgs)
    );
  }
  pipeSanitized(commandProcess.stdout, freezeProcess.stdin);
  pipeSanitized(commandProcess.stderr, freezeProcess.stdin);

  const commandExit = waitForExit(commandProcess).then((code) => {
    freezeProcess.stdin?.end();
    return code;
  });
  const freezeExit = waitForExit(freezeProcess);

  const timeoutMs = resolveScreenshotTimeoutMs(process.env);
  const timeout = createTimeout(timeoutMs, () => {
    if (!commandProcess.killed) {
      commandProcess.kill("SIGTERM");
    }
    if (!freezeProcess.killed) {
      freezeProcess.kill("SIGTERM");
    }
  });

  const completion = Promise.all([commandExit, freezeExit]);
  let commandCode: number;
  let freezeCode: number;
  try {
    [commandCode, freezeCode] = (await Promise.race([
      completion,
      timeout.promise
    ])) as [number, number];
  } finally {
    timeout.cancel();
    completion.catch(() => undefined);
  }

  if (commandCode !== 0) {
    const label = [target.command, ...target.args].join(" ");
    throw new Error(`${label} failed with exit code ${commandCode}`);
  }
  if (freezeCode !== 0) {
    throw new Error(`freeze failed with exit code ${freezeCode}`);
  }

  process.stdout.write(`${outputPath}\n`);
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
