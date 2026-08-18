import type { Command } from "commander";
import { getTheme, renderTable, withSpinner } from "toolcraft-design";
import { POE_PROVIDER_ID } from "@poe-code/providers";
import type { ConfiguredServiceMetadata } from "@poe-code/poe-code-config";
import type { CliContainer } from "../container.js";
import {
  createExecutionResources,
  resolveAgentDefinition,
  resolveCommandFlags,
  type ExecutionResources
} from "./shared.js";
import { loadConfiguredServices } from "../../services/config.js";
import { checkPoeAuth as checkPoeCredential } from "../../sdk/auth-check.js";
import { createBinaryExistsCheck } from "../../utils/command-checks.js";

interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

interface ModelCatalog {
  ok: boolean;
  /** Bare and `owner/model` ids, lower-cased, for configured-model lookups. */
  ids: Set<string>;
  detail: string;
}

type ConfiguredServices = Record<string, ConfiguredServiceMetadata>;

export function registerDoctorCommand(program: Command, container: CliContainer): void {
  program
    .command("doctor")
    .description("Check setup health: auth, configured agents, model catalog, and agent runtimes.")
    .action(async () => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "doctor");
      resources.logger.intro("doctor");

      const checks = await withSpinner<DoctorCheck[]>({
        message: "Checking setup health...",
        fn: () => runChecks(container, resources),
        stopMessage: (result) =>
          `${result.filter((check) => check.ok).length}/${result.length} checks passed`
      });

      const theme = getTheme();
      resources.logger.info(
        renderTable({
          theme,
          columns: [
            { name: "Check", title: "Check", alignment: "left", maxLen: 8 },
            { name: "Status", title: "Status", alignment: "left", maxLen: 6 },
            { name: "Detail", title: "Detail", alignment: "left", maxLen: 64 }
          ],
          rows: checks.map((check) => ({
            Check: check.name,
            Status: check.ok ? theme.success("pass") : theme.error("fail"),
            Detail: check.detail
          }))
        })
      );

      if (checks.some((check) => !check.ok)) {
        process.exitCode = 1;
      }
      resources.context.finalize();
    });
}

async function runChecks(
  container: CliContainer,
  resources: ExecutionResources
): Promise<DoctorCheck[]> {
  const credential = await resolvePoeCredential(container);
  const services = await loadConfiguredServices({
    fs: container.fs,
    filePath: container.env.configPath,
    projectFilePath: container.env.projectConfigPath,
    readOnly: true
  });
  const catalog = await fetchModelCatalog(container, credential);

  return [
    await checkAuth(container, credential),
    checkConfiguredAgents(services),
    { name: "models", ok: catalog.ok, detail: catalog.detail },
    await checkRuntimes(services, resources)
  ];
}

async function resolvePoeCredential(container: CliContainer): Promise<string | null> {
  try {
    return await container.providerRegistry.resolveCredential(POE_PROVIDER_ID, undefined, {
      envVars: container.env.variables,
      readOnly: true
    });
  } catch {
    return null;
  }
}

async function checkAuth(container: CliContainer, credential: string | null): Promise<DoctorCheck> {
  if (!credential) {
    return { name: "auth", ok: false, detail: 'Not logged in. Run "poe-code login".' };
  }

  try {
    await checkPoeCredential({
      apiKey: credential,
      baseUrl: container.env.poeBaseUrl,
      httpClient: container.httpClient
    });
    return { name: "auth", ok: true, detail: "Logged in" };
  } catch (error) {
    return {
      name: "auth",
      ok: false,
      detail: `${describeError(error)} Run "poe-code login".`
    };
  }
}

async function fetchModelCatalog(
  container: CliContainer,
  credential: string | null
): Promise<ModelCatalog> {
  try {
    const response = await container.httpClient(`${container.env.poeBaseUrl}/v1/models`, {
      method: "GET",
      headers: credential ? { Authorization: `Bearer ${credential}` } : {}
    });
    if (!response.ok) {
      return {
        ok: false,
        ids: new Set(),
        detail: `Catalog unreachable (HTTP ${response.status}). Run "poe-code models".`
      };
    }

    const body = (await response.json()) as { data?: Array<{ id?: string; owned_by?: string }> };
    const models = body.data ?? [];
    const ids = new Set<string>();
    for (const model of models) {
      if (typeof model.id !== "string") {
        continue;
      }
      const id = model.id.toLowerCase();
      ids.add(id);
      if (typeof model.owned_by === "string") {
        ids.add(`${model.owned_by.toLowerCase()}/${id}`);
      }
    }
    return {
      ok: true,
      ids,
      detail: `${models.length} ${models.length === 1 ? "model" : "models"} available`
    };
  } catch (error) {
    return { ok: false, ids: new Set(), detail: describeError(error) };
  }
}

function checkConfiguredAgents(services: ConfiguredServices): DoctorCheck {
  const entries = Object.entries(services);
  if (entries.length === 0) {
    return {
      name: "agents",
      ok: false,
      detail: 'No agents configured. Run "poe-code configure".'
    };
  }

  const labels = entries.map(([service]) => service);

  const detail = labels.join(", ");
  return {
    name: "agents",
    ok: true,
    detail
  };
}

async function checkRuntimes(
  services: ConfiguredServices,
  resources: ExecutionResources
): Promise<DoctorCheck> {
  const present: string[] = [];
  const missing: string[] = [];

  for (const service of Object.keys(services)) {
    const binaryName = resolveAgentDefinition(service)?.binaryName;
    if (!binaryName) {
      continue;
    }
    const check = createBinaryExistsCheck(binaryName, `${service}-binary`, `${binaryName} on PATH`);
    try {
      await check.run({
        isDryRun: false,
        verbose: resources.logger.context.verbose,
        runCommand: resources.context.runCommand
      });
      present.push(binaryName);
    } catch {
      missing.push(binaryName);
    }
  }

  if (missing.length > 0) {
    return {
      name: "runtime",
      ok: false,
      detail: `Not on PATH: ${missing.join(", ")}. Run "poe-code install <agent>".`
    };
  }
  return {
    name: "runtime",
    ok: true,
    detail: present.length > 0 ? `On PATH: ${present.join(", ")}` : "No agent binaries to check."
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
