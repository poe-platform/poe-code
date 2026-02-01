import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, existsSync, accessSync, constants } from "node:fs";
import { createRequire } from "node:module";
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

const DEFAULT_SCREENSHOT_TIMEOUT_MS = 30000;

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

export function resolveFreezeCommand(
  env: NodeJS.ProcessEnv
): string {
  const override = env.POE_FREEZE_PATH;
  if (typeof override === "string" && override.trim().length > 0) {
    if (!existsSync(override)) {
      throw new Error(`POE_FREEZE_PATH points to missing binary: ${override}`);
    }
    return override;
  }

  const systemFreeze = resolveSystemFreeze();
  if (systemFreeze) {
    return systemFreeze;
  }

  const pathFreeze = resolveFreezeFromPath(env);
  if (pathFreeze) {
    return pathFreeze;
  }

  const require = createRequire(import.meta.url);
  try {
    return require.resolve("@poe-code/freeze-cli/bin/freeze");
  } catch {
    throw new Error(
      "Unable to resolve @poe-code/freeze-cli. Install it or set POE_FREEZE_PATH."
    );
  }
}

function resolveSystemFreeze(): string | null {
  const systemPath = buildSystemPath(process.env);
  if (probeFreeze("freeze", systemPath)) {
    return "freeze";
  }
  const candidates = ["/opt/homebrew/bin/freeze", "/usr/local/bin/freeze"];
  for (const candidate of candidates) {
    if (probeFreeze(candidate, systemPath)) {
      return candidate;
    }
  }
  return null;
}

function resolveFreezeFromPath(
  env: NodeJS.ProcessEnv
): string | null {
  const pathValue = buildSystemPath(env);
  const segments = pathValue.length > 0
    ? pathValue.split(path.delimiter)
    : [];
  for (const segment of segments) {
    if (segment.length === 0) {
      continue;
    }
    const candidate = path.join(segment, "freeze");
    const resolved = resolveExecutable(candidate);
    if (resolved) {
      return resolved;
    }
  }

  const commonCandidates = [
    "/opt/homebrew/bin/freeze",
    "/usr/local/bin/freeze"
  ];
  for (const candidate of commonCandidates) {
    const resolved = resolveExecutable(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function buildSystemPath(env: NodeJS.ProcessEnv): string {
  const pathValue = typeof env.PATH === "string" ? env.PATH : "";
  if (pathValue.length === 0) {
    return "";
  }
  const segments = pathValue.split(path.delimiter);
  const filtered = segments.filter((segment) => {
    if (segment.length === 0) {
      return false;
    }
    return !segment.includes("node_modules/.bin");
  });
  return filtered.join(path.delimiter);
}

function probeFreeze(command: string, systemPath: string): boolean {
  const result = spawnSync(command, ["--help"], {
    stdio: "ignore",
    timeout: 1500,
    env: {
      ...process.env,
      PATH: systemPath
    }
  });
  return result.status === 0;
}

function resolveExecutable(candidate: string): string | null {
  if (!existsSync(candidate)) {
    return null;
  }
  try {
    accessSync(candidate, constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
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
  const freezeEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: buildSystemPath(process.env)
  };
  const freezeProcess = spawn(
    resolveFreezeCommand(process.env),
    ["-o", outputPath, "--window", "--padding", "20", "--language", "ansi"],
    {
      stdio: ["pipe", "inherit", "inherit"],
      env: freezeEnv
    }
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
