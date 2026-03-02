import path from "node:path";
import type { DoctorCheck } from "./types.js";
import type { ProviderService } from "../../cli/service-registry.js";
import type { ConfiguredServiceMetadata } from "../../services/config.js";
import {
  resolveAgentSupport,
  resolveConfigPath as resolveMcpPackagePath
} from "@poe-code/agent-mcp-config";
import { systemChecks } from "./checks/system.js";
import { authChecks } from "./checks/auth.js";
import { binaryCheck, configProbeCheck, serviceConfiguredCheck } from "./checks/agent.js";
import { mcpConfigValidCheck } from "./checks/mcp.js";

export interface CollectChecksOptions {
  homeDir: string;
  platform: NodeJS.Platform;
}

export function collectChecks(
  providers: ProviderService[],
  configuredServices: Record<string, ConfiguredServiceMetadata>,
  agentFilter?: string,
  options?: CollectChecksOptions
): DoctorCheck[] {
  const checks: DoctorCheck[] = [...systemChecks(), ...authChecks()];

  for (const provider of providers) {
    if (provider.disabled) continue;
    if (!(provider.name in configuredServices)) continue;
    if (agentFilter && provider.name !== agentFilter) continue;

    if (provider.isolatedEnv) {
      const category = `agent:${provider.name}`;

      checks.push(
        binaryCheck(category, provider.name, provider.isolatedEnv.agentBinary)
      );

      if (
        provider.isolatedEnv.configProbe &&
        provider.isolatedEnv.requiresConfig !== false
      ) {
        checks.push(configProbeCheck(category, provider));
      }

      if (provider.configurePrompts?.model) {
        checks.push(serviceConfiguredCheck(category, provider.name));
      }
    }

    if (options) {
      const mcpChecks = collectMcpChecks(
        provider.name,
        options.homeDir,
        options.platform
      );
      checks.push(...mcpChecks);
    }
  }

  return checks;
}

function collectMcpChecks(
  providerName: string,
  homeDir: string,
  platform: NodeJS.Platform
): DoctorCheck[] {
  const support = resolveAgentSupport(providerName);
  if (support.status !== "supported" || !support.config) {
    return [];
  }

  const config = support.config;
  const rawPath = resolveMcpPackagePath(
    config,
    platform as "darwin" | "linux" | "win32"
  );
  const configPath = rawPath.startsWith("~/")
    ? path.join(homeDir, rawPath.slice(2))
    : rawPath;

  return [
    mcpConfigValidCheck(providerName, configPath, config.format, config.configKey)
  ];
}
