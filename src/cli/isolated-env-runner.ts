import { spawn } from "node:child_process";
import type { ProviderIsolatedEnv } from "./service-registry.js";
import type { CliEnvironment } from "./environment.js";
import { resolveIsolatedEnvDetails } from "./isolated-env.js";
import type { FileSystem } from "../utils/file-system.js";
import type { CommandRunner } from "../utils/command-checks.js";
import { checkBinaryExists } from "../utils/command-checks.js";

export async function isolatedEnvRunner(input: {
  env: CliEnvironment;
  providerName: string;
  isolated: ProviderIsolatedEnv;
  argv: string[];
  fs?: FileSystem;
  commandRunner?: CommandRunner;
}): Promise<never> {
  const details = resolveIsolatedEnvDetails(
    input.env,
    input.isolated,
    input.providerName
  );
  const [, , ...args] = input.argv;

  const hasConfig = await configExists(
    input.fs,
    details.configProbePath
  );

  if (!hasConfig) {
    throw new Error(
      `${input.providerName} is not configured. Run 'poe-code login' or 'poe-code configure ${input.providerName}'.`
    );
  }

  if (input.commandRunner) {
    try {
      await checkBinaryExists(details.agentBinary, input.commandRunner);
    } catch {
      throw new Error(
        `${input.providerName} binary "${details.agentBinary}" not found. Please ensure it is installed and available on PATH.`
      );
    }
  }

  const child = spawn(details.agentBinary, args, {
    stdio: "inherit",
    env: {
      ...(process.env as Record<string, string | undefined>),
      ...details.env
    }
  });

  return await new Promise((_, reject) => {
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      process.exit(code ?? 0);
    });
  });
}

async function configExists(
  fs: FileSystem | undefined,
  filePath: string
): Promise<boolean> {
  if (!fs) {
    return true;
  }
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}
