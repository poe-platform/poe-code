import type { CapturedExchange } from './proxy-types.js';

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  command?: string;
}

export interface ContainerOptions {
  image?: string;
  testName?: string;
  useSnapshots?: boolean;
}

export interface CapturedRequests {
  readonly length: number;
  at(index: number): CapturedExchange;
  all(): CapturedExchange[];
  forRoute(path: string): CapturedRequests;
  withToolCalls(): CapturedRequests;
  withToolResults(): CapturedRequests;
  toolNamesAt(index: number): string[];
  toolCallsAt(index: number): Array<{ name: string; arguments: Record<string, unknown> }>;
  messagesAt(index: number): Array<{
    role: string;
    content?: string;
    name?: string;
    tool_call_id?: string;
  }>;
  toolResultAt(index: number, toolName: string): { content: string; tool_call_id: string } | undefined;
  summary(): string;
  debugAt(index: number): string;
}

export interface Container {
  id: string;
  home: string;
  workspace: string;
  destroy(): Promise<void>;
  exec(command: string): Promise<ExecResult>;
  execOrThrow(command: string): Promise<ExecResult>;
  login(): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  proxyLog(): Promise<string | null>;
  requests(): Promise<CapturedRequests>;
  writeSnapshots(
    snapshots: Array<{ key: string; response: unknown }>
  ): Promise<void>;
}

export type Engine = 'podman';
