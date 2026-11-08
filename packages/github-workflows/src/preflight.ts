import { UserError } from "toolcraft";

export interface PreflightContext {
  env: { get(key: string): string | undefined };
  nodeVersion: string;
}

export function runPreflightChecks(context: PreflightContext): void {
  checkRequiredEnvVar(context.env, "POE_API_KEY");
  checkNodeVersion(context.nodeVersion);
}

function checkRequiredEnvVar(
  env: { get(key: string): string | undefined },
  key: string
): void {
  const value = env.get(key);
  if (value === undefined || value.trim() === "") {
    throw new UserError(`Missing required environment variable: ${key}`);
  }
}

function checkNodeVersion(version: string): void {
  const major = Number.parseInt(version.replace(/^v/, ""), 10);
  if (Number.isNaN(major) || major < 18) {
    throw new UserError(`Node.js 18 or later is required (current: ${version}).`);
  }
}
