import type { TemplateBase } from "e2b";
import type { Readable } from "node:stream";

export interface E2bSandbox {
  readonly sandboxId: string;
  readonly commands: E2bCommands;
  readonly files: E2bFiles;
  readonly pty: E2bPty;
  setTimeout(timeoutMs: number): Promise<void>;
  kill(): Promise<void>;
}

export interface E2bCommands {
  list(): Promise<E2bProcessInfo[]>;
  run(command: string, opts?: E2bCommandOptions): Promise<E2bCommandResult | E2bCommandHandle>;
  connect(pid: number, opts?: E2bCommandConnectOptions): Promise<E2bCommandHandle>;
  sendStdin(pid: number, data: string | Uint8Array): Promise<void>;
  closeStdin?(pid: number): Promise<void>;
  kill(pid: number): Promise<boolean>;
}

export interface E2bPty {
  create(opts: E2bPtyOptions): Promise<E2bCommandHandle>;
  sendInput(pid: number, data: Uint8Array): Promise<void>;
  kill(pid: number): Promise<boolean>;
}

export interface E2bFiles {
  read(path: string, opts: { format: "bytes" }): Promise<Uint8Array>;
  read(path: string): Promise<string>;
  write(path: string, data: string | ArrayBuffer | Blob | ReadableStream): Promise<unknown>;
  list(
    path: string
  ): Promise<Array<{ name: string; path: string; type?: "file" | "dir"; size: number }>>;
  makeDir(path: string): Promise<boolean>;
  rename(oldPath: string, newPath: string): Promise<unknown>;
  remove(path: string): Promise<void>;
  getInfo(path: string): Promise<{ type?: "file" | "dir"; size: number }>;
  watchDir(
    path: string,
    onEvent: () => void | Promise<void>,
    opts?: { recursive?: boolean; onExit?: (error?: Error) => void | Promise<void> }
  ): Promise<{ stop(): Promise<void> }>;
}

export interface E2bProcessInfo {
  pid: number;
  cmd: string;
  args: string[];
}

export interface E2bCommandOptions {
  background?: boolean;
  cwd?: string;
  envs?: Record<string, string>;
  stdin?: boolean;
  timeoutMs?: number;
  onStdout?: (data: string) => void | Promise<void>;
  onStderr?: (data: string) => void | Promise<void>;
}

export interface E2bPtyOptions {
  cols: number;
  rows: number;
  cwd?: string;
  envs?: Record<string, string>;
  timeoutMs?: number;
  onData: (data: Uint8Array) => void | Promise<void>;
}

export interface E2bCommandConnectOptions {
  timeoutMs?: number;
  onStdout?: (data: string) => void | Promise<void>;
  onStderr?: (data: string) => void | Promise<void>;
}

export interface E2bCommandResult {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

export interface E2bCommandHandle {
  readonly pid: number;
  wait(): Promise<E2bCommandResult>;
  kill(): Promise<boolean>;
}

export interface CreateSandboxOptions {
  apiKey: string;
  templateId: string;
  env: Record<string, string>;
  timeoutMinutes?: number;
}

export interface BuildTemplateOptions {
  apiKey: string;
  name: string;
  dockerfilePath: string;
  buildContext: string;
  cpu?: number;
  memoryMb?: number;
  fromTemplate?: string;
  onLog?: (entry: BuildLogEntry) => void;
}

export interface BuildLogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: Date;
}

export interface BuildTemplateResult {
  templateId: string;
}

export interface SandboxInfo {
  sandboxId: string;
}

export async function createSandbox(opts: CreateSandboxOptions): Promise<E2bSandbox> {
  const { Sandbox } = await import("e2b");
  return Sandbox.create(opts.templateId, {
    apiKey: opts.apiKey,
    envs: opts.env,
    ...(opts.timeoutMinutes === undefined ? {} : { timeoutMs: opts.timeoutMinutes * 60_000 })
  }) as Promise<E2bSandbox>;
}

export async function connectSandbox(id: string, apiKey?: string): Promise<E2bSandbox> {
  const { Sandbox } = await import("e2b");
  return Sandbox.connect(id, apiKey === undefined ? undefined : { apiKey }) as Promise<E2bSandbox>;
}

export async function buildTemplate(opts: BuildTemplateOptions): Promise<BuildTemplateResult> {
  const { Template } = await import("e2b");
  const template = Template({ fileContextPath: opts.buildContext }).fromDockerfile(
    opts.dockerfilePath
  );
  if (opts.fromTemplate !== undefined && opts.fromTemplate.length > 0) {
    (template as TemplateBase).fromTemplate(opts.fromTemplate);
  }
  const result = await Template.build(template, opts.name, {
    apiKey: opts.apiKey,
    ...(opts.cpu === undefined ? {} : { cpuCount: opts.cpu }),
    ...(opts.memoryMb === undefined ? {} : { memoryMB: opts.memoryMb }),
    ...(opts.onLog ? { onBuildLogs: opts.onLog } : {})
  });
  return { templateId: result.templateId };
}

export async function listSandboxes(apiKey?: string): Promise<SandboxInfo[]> {
  const { Sandbox } = await import("e2b");
  const paginator = Sandbox.list(apiKey === undefined ? undefined : { apiKey });
  const sandboxes: SandboxInfo[] = [];
  while (paginator.hasNext) {
    sandboxes.push(...((await paginator.nextItems()) as SandboxInfo[]));
  }
  return sandboxes;
}

export function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const output = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(output).set(buffer);
  return output;
}

export async function readableToString(stream: Readable | null): Promise<string> {
  if (stream === null) {
    return "";
  }
  stream.setEncoding("utf8");
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(String(chunk));
  }
  return chunks.join("");
}
