import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

type CliStream = {
  write(chunk: string): void;
};

export type RunCliOptions = {
  cwd?: string;
  stdout?: CliStream;
  stderr?: CliStream;
};

export async function runCli(argv: readonly string[], options: RunCliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const cwd = options.cwd ?? process.cwd();

  if (argv.includes("--help") || argv.includes("-h")) {
    stderr.write(`${createUsage()}\n`);
    return 0;
  }

  const [filepath] = argv;

  if (filepath === undefined || argv.length !== 1) {
    stderr.write(`${createUsage()}\n`);
    return 1;
  }

  try {
    const result = await runRunner(path.resolve(cwd, filepath), cwd);
    stdout.write(result.stdout);
    stderr.write(result.stderr);
    return result.exitCode;
  } catch (error) {
    stderr.write(`${readErrorMessage(error)}\n`);
    return 1;
  }
}

function runRunner(
  filepath: string,
  cwd: string
): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, createRunnerArgs(filepath), {
      cwd,
      env: createChildEnv(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stderr,
        stdout
      });
    });
  });
}

function createRunnerArgs(filepath: string): string[] {
  const runnerPath = new URL(import.meta.url.endsWith(".ts") ? "./example-runner.ts" : "./example-runner.js", import.meta.url);

  if (runnerPath.pathname.endsWith(".ts")) {
    return ["--import", "tsx", runnerPath.pathname, filepath];
  }

  return [runnerPath.pathname, filepath];
}

function createUsage(): string {
  return "Usage: node --experimental-strip-types packages/agent-script/src/cli.ts <script.md>";
}

function createChildEnv(): NodeJS.ProcessEnv {
  const env = {
    ...process.env
  };

  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  return env;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
