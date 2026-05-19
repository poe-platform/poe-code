import path from "node:path";
import {
  createHostRunner,
  type RunHandle,
  type Runner,
  type RunSpec
} from "@poe-code/process-runner";
import { loadEval } from "../source/registry.js";
import type { EvalSource } from "../types.js";

export async function verifyOracle(
  source: EvalSource,
  id: string
): Promise<{ passed: boolean; output: string }> {
  const evalDef = await loadEval(source, id);

  if (evalDef.verify === undefined) {
    return {
      passed: true,
      output: "no verify command configured"
    };
  }

  const oracleDir = path.resolve(source.rootDir, id, "oracle");
  const result = await runVerifyCommand(createHostRunner(), {
    command: evalDef.verify.command,
    cwd: oracleDir,
    env: createOracleEnv(oracleDir),
    timeoutMs: evalDef.verify.timeoutMs
  });

  return {
    passed: result.exitCode === 0 && !result.timedOut,
    output: result.output
  };
}

async function runVerifyCommand(
  runner: Runner,
  input: {
    command: string;
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
  }
): Promise<{ exitCode: number; output: string; timedOut: boolean }> {
  const handle = runner.exec(createShellRunSpec(input));
  const stdout = captureStream(handle.stdout);
  const stderr = captureStream(handle.stderr);
  const timedResult = await waitForResult(handle, input.timeoutMs);

  if (timedResult.timedOut) {
    killQuietly(handle);
    return {
      exitCode: timedResult.exitCode,
      output: appendTimeoutNote(
        `${stdout.output()}${stderr.output()}`,
        `verification timed out after ${input.timeoutMs}ms`
      ),
      timedOut: true
    };
  }

  await Promise.all([stdout.finished, stderr.finished]);

  return {
    exitCode: timedResult.exitCode,
    output: `${stdout.output()}${stderr.output()}`,
    timedOut: timedResult.timedOut
  };
}

function createShellRunSpec(input: {
  command: string;
  cwd: string;
  env: Record<string, string>;
}): RunSpec {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", input.command],
      cwd: input.cwd,
      env: input.env,
      stdout: "pipe",
      stderr: "pipe"
    };
  }

  return {
    command: "sh",
    args: ["-c", input.command],
    cwd: input.cwd,
    env: input.env,
    stdout: "pipe",
    stderr: "pipe"
  };
}

function createOracleEnv(oracleDir: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  env.ORACLE_DIR = oracleDir;
  return env;
}

async function waitForResult(
  handle: RunHandle,
  timeoutMs: number
): Promise<{ exitCode: number; timedOut: boolean }> {
  let timeout: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<{ exitCode: number; timedOut: true }>((resolve) => {
    timeout = setTimeout(() => {
      resolve({ exitCode: 1, timedOut: true });
    }, timeoutMs);
  });

  const result = await Promise.race([
    handle.result.then((runResult) => ({
      exitCode: runResult.exitCode,
      timedOut: false as const
    })),
    timeoutPromise
  ]);

  if (timeout !== null) {
    clearTimeout(timeout);
  }

  return result;
}

function captureStream(stream: NodeJS.ReadableStream | null): {
  output(): string;
  finished: Promise<void>;
} {
  if (stream === null) {
    return {
      output: () => "",
      finished: Promise.resolve()
    };
  }

  let output = "";
  stream.setEncoding("utf8");

  const finished = new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: string) => {
      output += chunk;
    });
    stream.once("end", resolve);
    stream.once("error", reject);
  });

  return {
    output: () => output,
    finished
  };
}

function appendTimeoutNote(output: string, note: string | undefined): string {
  if (note === undefined) {
    return output;
  }

  if (output.length === 0) {
    return note;
  }

  return output.endsWith("\n") ? `${output}${note}` : `${output}\n${note}`;
}

function killQuietly(handle: RunHandle): void {
  try {
    handle.kill("SIGTERM");
  } catch {
    // Best effort cleanup after the configured verification timeout.
  }
}
