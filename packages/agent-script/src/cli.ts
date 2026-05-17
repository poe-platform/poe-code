import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

type CliStream = {
  write(chunk: string): void;
};

export type ReadMarkdownFile = (filepath: string, encoding: "utf8") => Promise<string>;
export type WriteMarkdownFile = (
  filepath: string,
  source: string,
  options: { encoding: "utf8" }
) => Promise<void>;

export type RunCliOptions = {
  cwd?: string;
  readFile?: ReadMarkdownFile;
  stdout?: CliStream;
  stderr?: CliStream;
  writeFile?: WriteMarkdownFile;
};

export async function runCli(
  argv: readonly string[],
  options: RunCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const cwd = options.cwd ?? process.cwd();

  if (argv.includes("--help") || argv.includes("-h")) {
    stderr.write(`${createUsage()}\n`);
    return 0;
  }

  const parsed = parseArgs(argv);
  const filepath = parsed.filepath;

  if (filepath === undefined) {
    stderr.write(`${createUsage()}\n`);
    return 1;
  }

  try {
    if (options.readFile !== undefined) {
      const { runExampleFile } = (await import("./example-runner.js")) as {
        runExampleFile: (
          filepath: string,
          options: {
            readFile?: ReadMarkdownFile;
            stderr?: CliStream;
            stdout?: CliStream;
            fix?: boolean;
            writeFile?: WriteMarkdownFile;
          }
        ) => Promise<number>;
      };

      return await runExampleFile(path.resolve(cwd, filepath), {
        fix: parsed.fix,
        readFile: options.readFile,
        stderr,
        stdout,
        writeFile: options.writeFile
      });
    }

    const result = await runRunner(path.resolve(cwd, filepath), cwd, parsed.fix);
    stdout.write(result.stdout);
    stderr.write(result.stderr);
    return result.exitCode;
  } catch (error) {
    stderr.write(`${readErrorMessage(error)}\n`);
    return 1;
  }
}

function parseArgs(argv: readonly string[]): { filepath: string | undefined; fix: boolean } {
  let fix = false;
  let filepath: string | undefined;

  for (const arg of argv) {
    if (arg === "--fix") {
      fix = true;
      continue;
    }

    if (filepath !== undefined) {
      return { filepath: undefined, fix };
    }
    filepath = arg;
  }

  return { filepath, fix };
}

function runRunner(
  filepath: string,
  cwd: string,
  fix: boolean
): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, createRunnerArgs(filepath, fix), {
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

function createRunnerArgs(filepath: string, fix: boolean): string[] {
  const runnerPath = new URL(
    import.meta.url.endsWith(".ts") ? "./example-runner.ts" : "./example-runner.js",
    import.meta.url
  );
  const args = fix ? ["--fix", filepath] : [filepath];

  if (runnerPath.pathname.endsWith(".ts")) {
    return ["--import", "tsx", runnerPath.pathname, ...args];
  }

  return [runnerPath.pathname, ...args];
}

function createUsage(): string {
  return [
    "Usage: node --experimental-strip-types packages/agent-script/src/cli.ts <script.md>",
    "       node --experimental-strip-types packages/agent-script/src/cli.ts --fix <script.md>",
    "",
    "Modes:",
    "  user-script mode: lints and runs the first ```js fenced block against stub example modules.",
    "  demo fallback mode: when no ```js block exists, runs bundled pipeline, superintendent, or experiment demos by frontmatter kind."
  ].join("\n");
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
