import type { HttpClient } from "../cli/http.js";
import type { CommandRunner } from "../utils/command-checks.js";
import { formatCommandRunnerResult } from "../utils/command-checks.js";
import { checkForUpdate, type VersionCheckResult } from "./version.js";

export type PoeCodePackageManager = "npm" | "bun" | "pnpm" | "yarn";

export interface PoeCodeUpdatePlan {
  packageManager: PoeCodePackageManager;
  command: string;
  args: string[];
}

export interface UpdatePoeCodeOptions {
  currentVersion: string;
  httpClient: HttpClient;
  runCommand: CommandRunner;
  env: Record<string, string | undefined>;
  packageManager?: PoeCodePackageManager;
  force?: boolean;
  checkVersion?: boolean;
}

export interface PoeCodeUpdateResult {
  status: "current" | "updated";
  plan: PoeCodeUpdatePlan;
  version: VersionCheckResult | null;
}

const POE_CODE_PACKAGE = "poe-code@latest";

export function detectPoeCodePackageManager(
  env: Record<string, string | undefined>
): PoeCodePackageManager {
  const userAgent = env.npm_config_user_agent ?? "";
  const userAgentManager = userAgent.split(" ")[0]?.split("/")[0];
  const normalizedUserAgentManager = normalizePackageManager(userAgentManager);
  if (normalizedUserAgentManager) {
    return normalizedUserAgentManager;
  }

  const execPath = env.npm_execpath ?? "";
  const execPathManager = detectPackageManagerFromPath(execPath);
  return execPathManager ?? "npm";
}

export function createPoeCodeUpdatePlan(options: {
  packageManager?: PoeCodePackageManager;
  env?: Record<string, string | undefined>;
}): PoeCodeUpdatePlan {
  const packageManager =
    options.packageManager ?? detectPoeCodePackageManager(options.env ?? {});

  if (packageManager === "bun") {
    return {
      packageManager,
      command: "bun",
      args: ["install", "-g", POE_CODE_PACKAGE]
    };
  }

  if (packageManager === "pnpm") {
    return {
      packageManager,
      command: "pnpm",
      args: ["add", "-g", POE_CODE_PACKAGE]
    };
  }

  if (packageManager === "yarn") {
    return {
      packageManager,
      command: "yarn",
      args: ["global", "add", POE_CODE_PACKAGE]
    };
  }

  return {
    packageManager,
    command: "npm",
    args: ["install", "-g", POE_CODE_PACKAGE]
  };
}

export async function updatePoeCode(
  options: UpdatePoeCodeOptions
): Promise<PoeCodeUpdateResult> {
  const plan = createPoeCodeUpdatePlan({
    packageManager: options.packageManager,
    env: options.env
  });
  const shouldCheckVersion = options.checkVersion !== false;
  const version = shouldCheckVersion
    ? await checkForUpdate({
        currentVersion: options.currentVersion,
        httpClient: options.httpClient
      })
    : null;

  if (version && !version.updateAvailable && options.force !== true) {
    return {
      status: "current",
      plan,
      version
    };
  }

  const result = await options.runCommand(plan.command, plan.args);
  if (result.exitCode !== 0) {
    throw new Error(
      [
        `poe-code update failed with exit code ${result.exitCode}: ${formatPoeCodeUpdateCommand(plan)}`,
        formatCommandRunnerResult(result)
      ].join("\n")
    );
  }

  return {
    status: "updated",
    plan,
    version
  };
}

export function formatPoeCodeUpdateCommand(plan: PoeCodeUpdatePlan): string {
  return [plan.command, ...plan.args].map(quoteCommandPart).join(" ");
}

function normalizePackageManager(value: string | undefined): PoeCodePackageManager | undefined {
  if (value === "npm" || value === "bun" || value === "pnpm" || value === "yarn") {
    return value;
  }
  return undefined;
}

function detectPackageManagerFromPath(value: string): PoeCodePackageManager | undefined {
  const lower = value.toLowerCase();
  if (lower.includes("bun")) {
    return "bun";
  }
  if (lower.includes("pnpm")) {
    return "pnpm";
  }
  if (lower.includes("yarn")) {
    return "yarn";
  }
  if (lower.includes("npm")) {
    return "npm";
  }
  return undefined;
}

function quoteCommandPart(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  if (!needsQuoting(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}

function needsQuoting(value: string): boolean {
  return value.includes(" ") || value.includes("\t") || value.includes("\n");
}
