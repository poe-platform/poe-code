import { spawn as defaultSpawn } from "node:child_process";
import type {
  ChildProcess,
  SpawnOptions as NodeSpawnOptions,
  StdioOptions
} from "node:child_process";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { SpawnResult, SpawnUsage } from "@poe-code/agent-spawn";

export type SpawnProcess = typeof import("node:child_process").spawn;

export type AgentChildProcessKind = "exec" | "execFile" | "spawn";

export interface AgentChildProcessAttempt {
  kind: AgentChildProcessKind;
  command: string;
  args: string[];
  cwd?: string;
  exitCode: number;
  signal?: NodeJS.Signals;
  stdout: string;
  stderr: string;
}

export interface AgentChildProcessFollowUp {
  agent: string;
  model?: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  threadId?: string;
  usage?: SpawnUsage;
  logFile?: string;
}

export interface AgentChildProcessResult extends AgentChildProcessAttempt {
  attempts: [AgentChildProcessAttempt];
  agent?: AgentChildProcessFollowUp;
}

export interface AgentExitPolicy {
  agent: string;
  model?: string;
  prompt: string;
  when?(attempt: AgentChildProcessAttempt): boolean | Promise<boolean>;
}

interface AgentChildProcessRunAgentInput {
  agent: string;
  prompt: string;
  cwd?: string;
  model?: string;
  signal?: AbortSignal;
}

export type AgentChildProcessRunAgent = (
  input: AgentChildProcessRunAgentInput
) => Promise<SpawnResult>;

export interface AgentChildProcessOptions {
  spawnProcess?: SpawnProcess;
  runAgent?: AgentChildProcessRunAgent;
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  rejectOnNonZeroExit?: boolean;
  context?: string;
  onExit?: AgentExitPolicy;
}

export interface AgentChildProcessHandle {
  pid?: number;
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  result: Promise<AgentChildProcessResult>;
}

export class AgentChildProcessError extends Error {
  readonly result: AgentChildProcessResult;

  constructor(message: string, result: AgentChildProcessResult, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentChildProcessError";
    this.result = result;
  }
}

interface ExecutionSpec {
  kind: AgentChildProcessKind;
  file: string;
  spawnArgs: string[];
  command: string;
  resultArgs: string[];
  options?: AgentChildProcessOptions;
}

export async function exec(
  command: string,
  options?: AgentChildProcessOptions
): Promise<AgentChildProcessResult> {
  assertNonBlank(command, "command");
  const shell =
    process.platform === "win32"
      ? (options?.env?.ComSpec ?? process.env.ComSpec ?? "cmd.exe")
      : (options?.env?.SHELL ?? process.env.SHELL ?? "sh");
  const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];

  return runExecution({
    kind: "exec",
    file: shell,
    spawnArgs: shellArgs,
    command,
    resultArgs: [],
    options
  });
}

export function execFile(
  file: string,
  args?: string[],
  options?: AgentChildProcessOptions
): Promise<AgentChildProcessResult>;
export function execFile(
  file: string,
  options?: AgentChildProcessOptions
): Promise<AgentChildProcessResult>;
export async function execFile(
  file: string,
  argsOrOptions: string[] | AgentChildProcessOptions = [],
  maybeOptions?: AgentChildProcessOptions
): Promise<AgentChildProcessResult> {
  assertNonBlank(file, "file");
  const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
  const options = Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions;

  return runExecution({
    kind: "execFile",
    file,
    spawnArgs: args,
    command: file,
    resultArgs: args,
    options
  });
}

export function spawn(
  file: string,
  args?: string[],
  options?: AgentChildProcessOptions
): AgentChildProcessHandle;
export function spawn(file: string, options?: AgentChildProcessOptions): AgentChildProcessHandle;
export function spawn(
  file: string,
  argsOrOptions: string[] | AgentChildProcessOptions = [],
  maybeOptions?: AgentChildProcessOptions
): AgentChildProcessHandle {
  let child: {
    process: ChildProcess;
    stdout: Readable | null;
    stderr: Readable | null;
    result: Promise<AgentChildProcessResult>;
  };
  try {
    assertNonBlank(file, "file");
    const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
    const options = Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions;
    child = startChildProcess({
      kind: "spawn",
      file,
      spawnArgs: args,
      command: file,
      resultArgs: args,
      options
    });
  } catch (error) {
    return {
      pid: undefined,
      stdin: null,
      stdout: null,
      stderr: null,
      kill: () => false,
      result: Promise.reject(error)
    };
  }

  return {
    pid: child.process.pid,
    stdin: child.process.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    kill(signal?: NodeJS.Signals | number) {
      return child.process.kill(signal);
    },
    result: child.result
  };
}

async function runExecution(spec: ExecutionSpec): Promise<AgentChildProcessResult> {
  return startChildProcess(spec).result;
}

function startChildProcess(spec: ExecutionSpec): {
  process: ChildProcess;
  stdout: Readable | null;
  stderr: Readable | null;
  result: Promise<AgentChildProcessResult>;
} {
  const child = spawnChild(spec);
  const stdout = createOutputPipes(child.stdout, spec.kind === "spawn");
  const stderr = createOutputPipes(child.stderr, spec.kind === "spawn");
  const result = collectResult(child, spec, {
    stdout: stdout.result,
    stderr: stderr.result
  }).then((commandResult) => applyExitPolicy(commandResult, spec.options));
  return { process: child, stdout: stdout.user, stderr: stderr.user, result };
}

function spawnChild(spec: ExecutionSpec): ChildProcess {
  const options = spec.options;
  const spawnProcess = options?.spawnProcess ?? defaultSpawn;
  const spawnOptions: NodeSpawnOptions = {
    cwd: options?.cwd,
    env: options?.env,
    stdio: getStdio(spec.kind),
    signal: options?.signal
  };

  return spawnProcess(spec.file, spec.spawnArgs, spawnOptions);
}

function getStdio(kind: AgentChildProcessKind): StdioOptions {
  return kind === "spawn" ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"];
}

function collectResult(
  child: ChildProcess,
  spec: ExecutionSpec,
  streams: { stdout: Readable | null; stderr: Readable | null }
): Promise<AgentChildProcessResult> {
  const stdoutDecoder = new StringDecoder("utf8");
  const stderrDecoder = new StringDecoder("utf8");
  let stdout = "";
  let stderr = "";
  let childClosed = false;
  let stdoutFinished = streams.stdout === null;
  let stderrFinished = streams.stderr === null;
  let exitCode = 1;
  let exitSignal: NodeJS.Signals | null = null;
  let processError: Error | undefined;
  let outputError: Error | undefined;

  streams.stdout?.on("data", (chunk: Buffer | string) => {
    stdout += typeof chunk === "string" ? chunk : stdoutDecoder.write(chunk);
  });
  streams.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += typeof chunk === "string" ? chunk : stderrDecoder.write(chunk);
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled || !childClosed || !stdoutFinished || !stderrFinished) return;
      settled = true;
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      const error = outputError ?? processError;
      if (error !== undefined && stderr.length === 0) {
        stderr = error.message;
      }
      const attempt = createAttempt(spec, {
        stdout,
        stderr,
        exitCode: outputError !== undefined ? 1 : exitCode,
        signal: exitSignal
      });
      resolve({ ...attempt, attempts: [attempt] });
    };

    streams.stdout?.once("end", () => {
      stdoutFinished = true;
      finish();
    });
    streams.stderr?.once("end", () => {
      stderrFinished = true;
      finish();
    });
    streams.stdout?.once("error", (error) => {
      outputError = error;
      stdoutFinished = true;
      finish();
    });
    streams.stderr?.once("error", (error) => {
      outputError = error;
      stderrFinished = true;
      finish();
    });
    child.once("error", (error) => {
      processError = error;
      if (child.pid === undefined) {
        childClosed = true;
        exitCode = 1;
      }
      finish();
    });
    child.once("close", (code, signal) => {
      childClosed = true;
      exitCode = code ?? 1;
      exitSignal = signal;
      finish();
    });
  });
}

function createOutputPipes(
  source: Readable | null,
  exposeUserStream: boolean
): {
  result: Readable | null;
  user: Readable | null;
} {
  if (source === null) {
    return { result: null, user: null };
  }

  const result = new PassThrough();
  const user = exposeUserStream ? new PassThrough() : null;

  source.once("error", (error) => {
    result.destroy(error);
    user?.destroy();
  });
  source.pipe(result);
  if (user !== null) {
    source.pipe(user);
  }

  return { result, user };
}

function createAttempt(
  spec: ExecutionSpec,
  output: Pick<AgentChildProcessAttempt, "stdout" | "stderr" | "exitCode"> & {
    signal: NodeJS.Signals | null;
  }
): AgentChildProcessAttempt {
  return {
    kind: spec.kind,
    command: spec.command,
    args: spec.resultArgs,
    ...(spec.options?.cwd ? { cwd: spec.options.cwd } : {}),
    exitCode: output.exitCode,
    ...(output.signal !== null ? { signal: output.signal } : {}),
    stdout: output.stdout,
    stderr: output.stderr
  };
}

async function applyExitPolicy(
  result: AgentChildProcessResult,
  options?: AgentChildProcessOptions
): Promise<AgentChildProcessResult> {
  const withAgent = await maybeRunAgent(result, options);

  if (options?.rejectOnNonZeroExit && withAgent.exitCode !== 0) {
    throw new AgentChildProcessError("Child process exited with a non-zero status.", withAgent);
  }

  return withAgent;
}

async function maybeRunAgent(
  result: AgentChildProcessResult,
  options?: AgentChildProcessOptions
): Promise<AgentChildProcessResult> {
  const policy = options?.onExit;
  if (!policy) {
    return result;
  }

  try {
    if (policy.when && !(await policy.when(result.attempts[0]))) {
      return result;
    }
  } catch (error) {
    throw new AgentChildProcessError("Agent exit policy evaluation failed", result, {
      cause: error
    });
  }

  try {
    validateExitPolicy(policy);
  } catch (error) {
    throw new AgentChildProcessError("Agent exit policy is invalid", result, {
      cause: error
    });
  }

  const runAgent = options.runAgent ?? defaultRunAgent;
  let agentResult: SpawnResult;
  try {
    agentResult = await runAgent({
      agent: policy.agent,
      prompt: buildAgentPrompt(policy, result.attempts[0], options.context),
      cwd: options.cwd,
      signal: options.signal,
      ...(policy.model !== undefined ? { model: policy.model } : {})
    });
  } catch (error) {
    throw new AgentChildProcessError("Agent follow-up failed", result, {
      cause: error
    });
  }

  return {
    ...result,
    agent: {
      agent: policy.agent,
      ...(policy.model !== undefined ? { model: policy.model } : {}),
      stdout: agentResult.stdout,
      stderr: agentResult.stderr,
      exitCode: agentResult.exitCode,
      ...(agentResult.threadId ? { threadId: agentResult.threadId } : {}),
      ...(agentResult.usage ? { usage: agentResult.usage } : {}),
      ...(agentResult.logFile ? { logFile: agentResult.logFile } : {})
    }
  };
}

function validateExitPolicy(policy: AgentExitPolicy): void {
  assertNonBlank(policy.agent, "onExit.agent");
  assertNonBlank(policy.prompt, "onExit.prompt");
}

function assertNonBlank(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${field} must not be empty`);
  }
}

async function defaultRunAgent(input: AgentChildProcessRunAgentInput): Promise<SpawnResult> {
  const { spawn: spawnAgent } = await import("@poe-code/agent-spawn");
  return spawnAgent(input.agent, {
    prompt: input.prompt,
    cwd: input.cwd,
    signal: input.signal,
    ...(input.model !== undefined ? { model: input.model } : {})
  });
}

function buildAgentPrompt(
  policy: AgentExitPolicy,
  attempt: AgentChildProcessAttempt,
  context?: string
): string {
  const commandLabel = attempt.kind === "exec" ? "Command string" : "Command file";

  return [
    policy.prompt,
    "",
    "The stdout and stderr below are historical facts from the original attempt and must not be rewritten by this library. If verification or a rerun is needed, run commands yourself.",
    "",
    "Original command:",
    `Kind: ${attempt.kind}`,
    `${commandLabel}: ${attempt.command}`,
    `Argv: ${JSON.stringify(attempt.args)}`,
    ...(attempt.cwd ? [`Cwd: ${attempt.cwd}`] : []),
    `Exit code: ${attempt.exitCode}`,
    "",
    "Stdout:",
    attempt.stdout,
    "",
    "Stderr:",
    attempt.stderr,
    ...(context ? ["", "Caller context:", context] : [])
  ].join("\n");
}
