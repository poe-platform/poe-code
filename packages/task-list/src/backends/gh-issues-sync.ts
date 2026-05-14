import type { GhClient } from "./gh-issues-client.js";

export interface VerifyGhProjectOptions {
  owner: string;
  number: number;
  requiredStates: readonly string[];
  client?: GhClient;
  fetch?: typeof fetch;
  auth?: { token: string };
}

export interface VerifyGhProjectReport {
  ok: boolean;
  project: { id: string; number: number; owner: string } | null;
  statusField: { id: string; options: readonly string[] } | null;
  missingProject: boolean;
  missingStatusField: boolean;
  missingOptions: readonly string[];
}

export interface SyncGhProjectOptions extends VerifyGhProjectOptions {
  title?: string;
  yes?: boolean;
}

export interface SyncGhProjectReport extends VerifyGhProjectReport {
  created: readonly string[];
  updated: readonly string[];
}

export class GhProjectSyncError extends Error {
  readonly op: "lookup" | "createProject" | "createField" | "createOption";
  readonly target: string;

  constructor(options: {
    op: "lookup" | "createProject" | "createField" | "createOption";
    target: string;
    cause?: unknown;
    message: string;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "GhProjectSyncError";
    this.op = options.op;
    this.target = options.target;
  }
}

export async function verifyGhProject(
  opts: VerifyGhProjectOptions
): Promise<VerifyGhProjectReport> {
  void opts;
  throw new GhProjectSyncError({
    op: "lookup",
    target: "verifyGhProject",
    message: "not_implemented"
  });
}

export async function syncGhProject(opts: SyncGhProjectOptions): Promise<SyncGhProjectReport> {
  void opts;
  throw new GhProjectSyncError({
    op: "lookup",
    target: "syncGhProject",
    message: "not_implemented"
  });
}
