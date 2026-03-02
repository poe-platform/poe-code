import type { DoctorCheck } from "./types.js";
import type { ProviderService } from "../../cli/service-registry.js";
import type { ConfiguredServiceMetadata } from "../../services/config.js";
import { systemChecks } from "./checks/system.js";
import { authChecks } from "./checks/auth.js";
import { binaryCheck, configProbeCheck, serviceConfiguredCheck } from "./checks/agent.js";

export function collectChecks(
  providers: ProviderService[],
  configuredServices: Record<string, ConfiguredServiceMetadata>,
  agentFilter?: string
): DoctorCheck[] {
  const checks: DoctorCheck[] = [...systemChecks(), ...authChecks()];

  for (const provider of providers) {
    if (provider.disabled) continue;
    if (!(provider.name in configuredServices)) continue;
    if (agentFilter && provider.name !== agentFilter) continue;
    if (!provider.isolatedEnv) continue;

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

  return checks;
}
