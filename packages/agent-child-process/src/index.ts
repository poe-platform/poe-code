import { spawn as defaultSpawn } from "node:child_process";
import type {
  ChildProcess,
  SpawnOptions as NodeSpawnOptions,
  StdioOptions
} from "node:child_process";
import type { Readable, Writable } from "node:stream";
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
  const shell = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : process.env.SHELL ?? "sh";
  const shellArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];

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
  const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
  const options = Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions;

  let child: { process: ChildProcess; result: Promise<AgentChildProcessResult> };
  try {
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
    stdout: child.process.stdout,
    stderr: child.process.stderr,
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
  result: Promise<AgentChildProcessResult>;
} {
  const child = spawnChild(spec);
  const result = collectResult(child, spec).then((commandResult) =>
    applyExitPolicy(commandResult, spec.options)
  );
  return { process: child, result };
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
  spec: ExecutionSpec
): Promise<AgentChildProcessResult> {
  const stdoutDecoder = new StringDecoder("utf8");
  const stderrDecoder = new StringDecoder("utf8");
  let stdout = "";
  let stderr = "";
  let settled = false;

  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdout += typeof chunk === "string" ? chunk : stdoutDecoder.write(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += typeof chunk === "string" ? chunk : stderrDecoder.write(chunk);
  });

  return new Promise((resolve) => {
    const finish = (exitCode: number, error?: Error) => {
      if (settled) return;
      settled = true;
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      if (error && stderr.length === 0) {
        stderr = error.message;
      }
      const attempt = createAttempt(spec, {
        stdout,
        stderr,
        exitCode
      });
      resolve({ ...attempt, attempts: [attempt] });
    };

    child.once("error", (error) => finish(1, error));
    child.once("close", (code) => finish(code ?? 1));
  });
}

function createAttempt(
  spec: ExecutionSpec,
  output: Pick<AgentChildProcessAttempt, "stdout" | "stderr" | "exitCode">
): AgentChildProcessAttempt {
  return {
    kind: spec.kind,
    command: spec.command,
    args: spec.resultArgs,
    ...(spec.options?.cwd ? { cwd: spec.options.cwd } : {}),
    exitCode: output.exitCode,
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

  const runAgent = options.runAgent ?? defaultRunAgent;
  const agentResult = await runAgent({
    agent: policy.agent,
    prompt: buildAgentPrompt(policy, result.attempts[0], options.context),
    cwd: options.cwd,
    signal: options.signal,
    ...(policy.model !== undefined ? { model: policy.model } : {})
  });

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
