import type { Command } from "commander";
import type { ConfigDocument } from "@poe-code/poe-code-config";
import type { CliContainer } from "../container.js";
import {
  createExecutionResources,
  resolveCommandFlags,
  resolveMergedDocument
} from "./shared.js";

interface BraintrustStatus {
  project: string;
  lastError: string | null;
  errorCount: number;
}

interface BraintrustIntegrations {
  status(): BraintrustStatus;
  shutdown(): Promise<void>;
}

interface BraintrustModule {
  bootstrap(config: ConfigDocument): Promise<BraintrustIntegrations | null>;
}

const BRAINTRUST_INSTALL_ERROR =
  "Braintrust integration is enabled but the 'braintrust' package is not installed. Run: npm i braintrust";

export function registerBraintrustCommand(program: Command, container: CliContainer): void {
  const braintrust = program
    .command("braintrust")
    .description("Inspect Braintrust integration status.");

  braintrust
    .command("status")
    .description("Show Braintrust integration status.")
    .action(async () => {
      await executeBraintrustStatus(program, container);
    });
}

async function executeBraintrustStatus(
  program: Command,
  container: CliContainer
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "braintrust:status");
  const config = await resolveMergedDocument(container);
  const braintrust = config.integrations?.braintrust;

  resources.logger.intro("braintrust status");

  if (braintrust?.enabled !== true) {
    resources.logger.info("disabled");
    resources.context.finalize();
    return;
  }

  const missing = missingBraintrustFields(braintrust);
  if (missing.length > 0) {
    for (const field of missing) {
      resources.logger.info(`missing ${field}`);
    }
    resources.context.finalize();
    return;
  }

  let integrations: BraintrustIntegrations | null = null;
  try {
    const { bootstrap } = await importBraintrustModule();
    integrations = await bootstrap(config);

    if (integrations === null) {
      resources.logger.info("disabled");
      resources.context.finalize();
      return;
    }

    const status = integrations.status();
    resources.logger.info(
      `enabled, project=${status.project}, last error: ${status.lastError ?? "none"}, errors: ${status.errorCount}`
    );
    resources.context.finalize();
  } catch (error) {
    if (isBraintrustInstallError(error)) {
      resources.logger.info("not installed: run npm i braintrust");
      resources.context.finalize();
      return;
    }
    throw error;
  } finally {
    await integrations?.shutdown();
  }
}

function missingBraintrustFields(
  braintrust: Record<string, unknown>
): Array<"apiKey" | "project"> {
  const missing: Array<"apiKey" | "project"> = [];
  if (!hasNonEmptyString(braintrust.apiKey)) {
    missing.push("apiKey");
  }
  if (!hasNonEmptyString(braintrust.project)) {
    missing.push("project");
  }
  return missing;
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function importBraintrustModule(): Promise<BraintrustModule> {
  return await import("@poe-code/braintrust") as BraintrustModule;
}

function isBraintrustInstallError(error: unknown): boolean {
  return error instanceof Error && error.message === BRAINTRUST_INSTALL_ERROR;
}
