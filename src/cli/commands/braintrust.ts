import type { Command } from "commander";
import { bootstrap } from "@poe-code/braintrust";
import {
  createConfigStore,
  integrationsConfigScope,
  readDocument,
  readDocumentReadonly
} from "@poe-code/poe-code-config/core";

import type { CliContainer } from "../container.js";
import {
  createExecutionResources,
  resolveCommandFlags,
  resolveMergedDocument
} from "./shared.js";

export function registerBraintrustCommand(program: Command, container: CliContainer): void {
  const braintrust = program
    .command("braintrust")
    .description("Inspect and manage the Braintrust integration.");

  braintrust
    .command("status")
    .description("Show Braintrust integration status.")
    .action(async () => {
      await executeBraintrustStatus(program, container);
    });

  braintrust
    .command("enable")
    .description("Enable the Braintrust integration in the global config.")
    .action(async () => {
      await executeBraintrustToggle(program, container, true);
    });

  braintrust
    .command("disable")
    .description("Disable the Braintrust integration in the global config.")
    .action(async () => {
      await executeBraintrustToggle(program, container, false);
    });
}

async function executeBraintrustStatus(
  program: Command,
  container: CliContainer
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "braintrust:status");
  const config = await resolveMergedDocument(container, { readOnly: true });
  const braintrust = config.integrations?.braintrust;

  resources.logger.intro("braintrust status");

  if (braintrust?.enabled !== true) {
    resources.logger.info("disabled");
    resources.logger.nextSteps(['Run "poe-code braintrust enable" to turn it on.']);
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

async function executeBraintrustToggle(
  program: Command,
  container: CliContainer,
  enabled: boolean
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const action = enabled ? "enable" : "disable";
  const resources = createExecutionResources(container, flags, `braintrust:${action}`);
  const configPath = container.env.configPath;

  resources.logger.intro(`braintrust ${action}`);

  const document = await (flags.dryRun ? readDocumentReadonly : readDocument)(
    container.fs,
    configPath
  );
  const current = document.integrations?.braintrust;

  if (flags.dryRun) {
    resources.logger.dryRun(
      `Dry run: would set integrations.braintrust.enabled to ${enabled} in ${configPath}`
    );
    resources.context.finalize();
    return;
  }

  await createConfigStore({ fs: container.fs, filePath: configPath })
    .scope(integrationsConfigScope)
    .set("braintrust", { ...current, enabled });
  resources.logger.success(`Braintrust ${enabled ? "enabled" : "disabled"} in ${configPath}`);

  const missing = enabled ? missingBraintrustFields(current ?? {}) : [];
  if (missing.length > 0) {
    resources.logger.nextSteps([
      ...missing.map((field) =>
        field === "apiKey"
          ? 'Set integrations.braintrust.apiKey, commonly "${BRAINTRUST_API_KEY}" via config interpolation.'
          : "Set integrations.braintrust.project to the Braintrust project name."
      ),
      'Run "poe-code braintrust status" to confirm.'
    ]);
  }

  resources.context.finalize();
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
