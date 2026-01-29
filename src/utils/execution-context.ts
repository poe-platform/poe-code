import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Represents how poe-code should be invoked
 */
export interface ExecutionCommand {
  /** The binary/command to run */
  command: string;
  /** Arguments to pass (excludes the subcommand) */
  args: string[];
}

export type ExecutionMode =
  | "global"          // Globally installed: poe-code
  | "npx"             // npx poe-code
  | "npx-latest"      // npx poe-code@latest
  | "npx-beta"        // npx poe-code@beta
  | "development";    // npm run dev / tsx

interface ExecutionContext {
  mode: ExecutionMode;
  command: ExecutionCommand;
}

interface DetectionInput {
  argv: string[];
  env: Record<string, string | undefined>;
  moduleUrl: string;
}

/**
 * Detects how poe-code is being executed and returns the appropriate
 * command format for spawning it again (e.g., for MCP server config)
 */
export function detectExecutionContext(input: DetectionInput): ExecutionContext {
  const { argv, env, moduleUrl } = input;

  // Check for development mode (tsx, ts-node, or npm run dev)
  if (isDevelopmentMode(argv, env)) {
    return createDevelopmentContext(moduleUrl);
  }

  // Check for npx execution
  if (isNpxExecution(env)) {
    const version = detectNpxVersion(env);
    return createNpxContext(version);
  }

  // Default to global installation
  return {
    mode: "global",
    command: {
      command: "poe-code",
      args: []
    }
  };
}

function isDevelopmentMode(
  argv: string[],
  env: Record<string, string | undefined>
): boolean {
  const scriptPath = argv[1] ?? "";

  // Running via tsx directly
  if (scriptPath.endsWith(".ts") || scriptPath.includes("/src/")) {
    return true;
  }

  // Running via npm run dev (check lifecycle event)
  if (env.npm_lifecycle_event === "dev") {
    return true;
  }

  // Check if node is running with tsx loader
  const nodeOptions = env.NODE_OPTIONS ?? "";
  if (nodeOptions.includes("tsx") || nodeOptions.includes("ts-node")) {
    return true;
  }

  return false;
}

function isNpxExecution(env: Record<string, string | undefined>): boolean {
  // npx sets npm_execpath to the npm/npx binary
  const execPath = env.npm_execpath ?? "";
  if (execPath.includes("npx") || execPath.includes("npm")) {
    // Also check if we're in a temporary npx cache directory
    const packagePath = env.npm_package_json ?? "";
    if (packagePath.includes("_npx") || packagePath.includes(".npm/_cacache")) {
      return true;
    }
  }

  // Check for npx-specific environment variable
  if (env.npm_command === "exec") {
    return true;
  }

  return false;
}

function detectNpxVersion(
  env: Record<string, string | undefined>
): "latest" | "beta" | "default" {
  // Try to detect version from package path or npm config
  const packageJson = env.npm_package_json ?? "";
  const packageVersion = env.npm_package_version ?? "";

  // Check if running from beta channel
  if (packageJson.includes("@beta") || packageVersion.includes("beta")) {
    return "beta";
  }

  // Check if explicitly using @latest
  if (packageJson.includes("@latest")) {
    return "latest";
  }

  return "default";
}

function createDevelopmentContext(moduleUrl: string): ExecutionContext {
  // Get the project root from the module URL
  // The module could be anywhere in src/, so find /src/ in the path
  const modulePath = fileURLToPath(moduleUrl);

  // Find the src directory in the path and get its parent
  const srcIndex = modulePath.lastIndexOf("/src/");
  const projectRoot = srcIndex !== -1
    ? modulePath.substring(0, srcIndex)
    : dirname(dirname(modulePath));

  return {
    mode: "development",
    command: {
      command: "npm",
      args: ["--silent", "--prefix", projectRoot, "run", "dev", "--"]
    }
  };
}

function createNpxContext(
  version: "latest" | "beta" | "default"
): ExecutionContext {
  const packageSpec = version === "default"
    ? "poe-code"
    : `poe-code@${version}`;

  return {
    mode: version === "default" ? "npx" : `npx-${version}` as ExecutionMode,
    command: {
      command: "npx",
      args: ["--yes", packageSpec]
    }
  };
}

/**
 * Converts an ExecutionCommand to the format expected by different MCP clients
 */
export function toMcpServerCommand(
  execCommand: ExecutionCommand,
  subcommand: string
): { command: string; args: string[] } {
  return {
    command: execCommand.command,
    args: [...execCommand.args, subcommand]
  };
}

/**
 * Converts an ExecutionCommand to OpenCode's MCP format (command as array)
 */
export function toOpenCodeMcpCommand(
  execCommand: ExecutionCommand,
  subcommand: string
): string[] {
  return [execCommand.command, ...execCommand.args, subcommand];
}

/**
 * Get the current execution context using process globals
 */
export function getCurrentExecutionContext(moduleUrl: string): ExecutionContext {
  return detectExecutionContext({
    argv: process.argv,
    env: process.env as Record<string, string | undefined>,
    moduleUrl
  });
}
