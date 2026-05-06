import type { Command } from "commander";
import { bootstrap } from "@poe-code/braintrust";

import type { CliContainer } from "../container.js";
import {
  createExecutionResources,
  resolveCommandFlags,
  resolveMergedDocument
} from "./shared.js";

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

  const integrations = bootstrap(braintrust);
  try {
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
