import type { FileSystem } from "../../utils/file-system.js";
import type { CliEnvironment } from "../../cli/environment.js";
import type { CommandRunner } from "../../utils/command-checks.js";
import type { HttpClient } from "../../cli/http.js";

export interface CheckResult {
  status: "pass" | "warn" | "fail" | "skip";
  message: string;
  fix?: string;
  detail?: string;
}

export interface DoctorContext {
  fs: FileSystem;
  env: CliEnvironment;
  runCommand: CommandRunner;
  httpClient: HttpClient;
  readApiKey: () => Promise<string | null>;
  verbose: boolean;
  dryRun: boolean;
  previousResults: Map<string, CheckResult>;
}

export interface DoctorCheck {
  id: string;
  category: string;
  description: string;
  run(ctx: DoctorContext): Promise<CheckResult>;
}

export interface DoctorResult {
  checks: Array<{ check: DoctorCheck; result: CheckResult }>;
  summary: { pass: number; warn: number; fail: number; skip: number };
}

export interface DoctorOptions {
  agent?: string;
  verbose?: boolean;
  dryRun?: boolean;
}
