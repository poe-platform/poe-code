import type { FileSystemDescription, RemoteError } from "./execution-filesystem.js";
import type { RunResult } from "./session.js";

export type PageMessage =
  | { kind: "start"; command: string; cwd: string; help: string; filesystem: FileSystemDescription }
  | { kind: "fs-result"; identity: number; value?: unknown; error?: RemoteError }
  | { kind: "aux-event"; identity: number; event: "message" | "messageerror" | "error"; value: unknown };

export type ExecutionMessage =
  | { kind: "ready" }
  | { kind: "state"; cwd: string }
  | { kind: "result"; result: RunResult }
  | { kind: "fs"; identity: number; method: string; args: unknown[] }
  | { kind: "aux-create"; identity: number; worker: string; data: unknown }
  | { kind: "aux-message"; identity: number; value: unknown }
  | { kind: "aux-close"; identity: number };
