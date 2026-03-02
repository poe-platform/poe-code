import path from "node:path";
import { isNotFound } from "@poe-code/config-mutations";
import type { DoctorCheck, DoctorContext, CheckResult } from "../types.js";
import type { ProviderService } from "../../../cli/service-registry.js";

export function binaryCheck(
  category: string,
  providerName: string,
  binaryName: string
): DoctorCheck {
  return {
    id: `agent.${providerName}.binary`,
    category,
    description: `${binaryName} binary exists`,
    async run(ctx: DoctorContext): Promise<CheckResult> {
      const result = await ctx.runCommand("which", [binaryName]);
      if (result.exitCode === 0) {
        return {
          status: "pass",
          message: `${binaryName} found`,
          detail: result.stdout.trim()
        };
      }
      return {
        status: "fail",
        message: `${binaryName} not found on PATH`,
        fix: `Run "poe-code install ${providerName}" to install it.`
      };
    }
  };
}

export function configProbeCheck(
  category: string,
  provider: ProviderService
): DoctorCheck {
  const providerName = provider.name;
  return {
    id: `agent.${providerName}.config-probe`,
    category,
    description: `${providerName} config exists`,
    async run(ctx: DoctorContext): Promise<CheckResult> {
      const binaryResult = ctx.previousResults.get(
        `agent.${providerName}.binary`
      );
      if (binaryResult && binaryResult.status === "fail") {
        return {
          status: "skip",
          message: `Skipped (${providerName} binary not found)`
        };
      }

      const isolated = provider.isolatedEnv!;
      const baseDir = path.join(ctx.env.homeDir, ".poe-code", providerName);
      const probe = isolated.configProbe!;
      const probePath =
        probe.kind === "isolatedFile"
          ? path.join(baseDir, probe.relativePath)
          : probe.relativePath
            ? path.join(baseDir, probe.relativePath)
            : baseDir;

      try {
        await ctx.fs.stat(probePath);
        return {
          status: "pass",
          message: `${providerName} config found`,
          detail: probePath
        };
      } catch (error) {
        if (isNotFound(error)) {
          return {
            status: "fail",
            message: `${providerName} config not found at ${probePath}`,
            fix: `Run "poe-code configure ${providerName}" to create it.`
          };
        }
        throw error;
      }
    }
  };
}

export function serviceConfiguredCheck(
  category: string,
  providerName: string
): DoctorCheck {
  return {
    id: `agent.${providerName}.configured`,
    category,
    description: `${providerName} configured`,
    async run(ctx: DoctorContext): Promise<CheckResult> {
      try {
        const raw = await ctx.fs.readFile(ctx.env.configPath, "utf8");
        const config = JSON.parse(raw);
        const services = config.configured_services;
        if (services && providerName in services) {
          return {
            status: "pass",
            message: `${providerName} is configured`
          };
        }
        return {
          status: "fail",
          message: `${providerName} not found in configured services`,
          fix: `Run "poe-code configure ${providerName}" to set it up.`
        };
      } catch (error) {
        if (isNotFound(error)) {
          return {
            status: "skip",
            message: "Config file not found"
          };
        }
        return {
          status: "fail",
          message: `Error reading config: ${(error as Error).message}`,
          fix: `Run "poe-code configure ${providerName}" to recreate config.`
        };
      }
    }
  };
}
