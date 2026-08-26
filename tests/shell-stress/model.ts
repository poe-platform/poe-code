import type { ShellLimits } from "../../src/index.js";

export interface StressCase {
  readonly name: string;
  readonly script: string;
  readonly stdin?: string;
  readonly initialFiles?: Readonly<Record<string, string>>;
  readonly env?: Readonly<Record<string, string>>;
  readonly limits?: ShellLimits;
}

export type Snapshot = Record<string, { type: "directory" } | { type: "file"; base64: string }>;

export interface Observation {
  stdout: string;
  stderr: string;
  stdoutBase64: string;
  stderrBase64: string;
  exitCode: number;
  files: Snapshot;
}

export interface ChildRequest {
  readonly kind: "script" | "probe";
  readonly fixture?: StressCase;
  readonly probe?: string;
}
