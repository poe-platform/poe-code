import { fileURLToPath } from "node:url";
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

export interface PoeCodeInstall {
  packageManager: PoeCodePackageManager;
  global: boolean;
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

/** Where this module lives, which is where poe-code was actually installed. */
const MODULE_PATH = fileURLToPath(import.meta.url);

/** Path fragments each package manager uses for its global install root. */
const GLOBAL_INSTALL_MARKERS: ReadonlyArray<{
  marker: string;
  packageManager: PoeCodePackageManager;
}> = [
  { marker: "/.bun/install/global/", packageManager: "bun" },
  { marker: "/pnpm/global/", packageManager: "pnpm" },
  { marker: "/.pnpm-global/", packageManager: "pnpm" },
  { marker: "/yarn/global/", packageManager: "yarn" },
  { marker: "/lib/node_modules/", packageManager: "npm" },
  { marker: "/npm/node_modules/", packageManager: "npm" }
];

const INSTALL_ARGS: Record<PoeCodePackageManager, { global: string[]; local: string[] }> = {
  npm: { global: ["install", "-g"], local: ["install"] },
  bun: { global: ["install", "-g"], local: ["install"] },
  pnpm: { global: ["add", "-g"], local: ["add"] },
  yarn: { global: ["global", "add"], local: ["add"] }
};

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

/**
 * Resolves how poe-code was installed from its own location on disk, which is a
 * far better signal than the environment of whatever runtime invoked it.
 */
export function detectPoeCodeInstall(
  options: {
    env?: Record<string, string | undefined>;
    installPath?: string;
  } = {}
): PoeCodeInstall {
  const installPath = (options.installPath ?? MODULE_PATH).replaceAll("\\", "/");
  const globalInstall = GLOBAL_INSTALL_MARKERS.find((entry) => installPath.includes(entry.marker));
  if (globalInstall) {
    return { packageManager: globalInstall.packageManager, global: true };
  }

  if (installPath.includes("/node_modules/")) {
    return {
      packageManager: installPath.includes("/node_modules/.pnpm/")
        ? "pnpm"
        : detectPoeCodePackageManager(options.env ?? {}),
      global: false
    };
  }

  return { packageManager: detectPoeCodePackageManager(options.env ?? {}), global: true };
}

export function createPoeCodeUpdatePlan(options: {
  packageManager?: PoeCodePackageManager;
  env?: Record<string, string | undefined>;
  installPath?: string;
}): PoeCodeUpdatePlan {
  const install = detectPoeCodeInstall({ env: options.env, installPath: options.installPath });
  const packageManager = options.packageManager ?? install.packageManager;
  const args = INSTALL_ARGS[packageManager][install.global ? "global" : "local"];

  return {
    packageManager,
    command: packageManager,
    args: [...args, POE_CODE_PACKAGE]
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
