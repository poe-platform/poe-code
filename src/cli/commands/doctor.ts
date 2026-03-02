import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  createExecutionResources,
  resolveCommandFlags,
  formatServiceList
} from "./shared.js";
import { loadConfiguredServices } from "../../services/config.js";
import { collectChecks, runChecks } from "../../sdk/doctor/index.js";
import type { DoctorResult, CheckResult } from "../../sdk/doctor/types.js";
import type { ScopedLogger } from "../logger.js";

export type DoctorCommandOptions = Record<string, never>;

export function registerDoctorCommand(
  program: Command,
  container: CliContainer
): Command {
  const serviceNames = container.registry.list().map((s) => s.name);
  return program
    .command("doctor")
    .description("Validate Poe configuration and connectivity.")
    .argument("[agent]", `Agent to check${formatServiceList(serviceNames)}`)
    .action(
      async (
        agentArg: string | undefined,
        options: DoctorCommandOptions
      ) => {
        const result = await executeDoctor(
          program,
          container,
          agentArg,
          options
        );
        if (result.summary.fail > 0) {
          process.exitCode = 1;
        }
      }
    );
}

export async function executeDoctor(
  program: Command,
  container: CliContainer,
  agentArg: string | undefined,
  _options: DoctorCommandOptions
): Promise<DoctorResult> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "doctor");

  resources.logger.intro("doctor");

  const configuredServices = await loadConfiguredServices({
    fs: container.fs,
    filePath: container.env.configPath
  });

  const providers = container.registry.list();
  const checks = collectChecks(providers, configuredServices, agentArg, {
    homeDir: container.env.homeDir,
    platform: container.env.platform
  });

  const result = await runChecks(checks, {
    fs: container.fs,
    env: container.env,
    runCommand: resources.context.runCommand,
    httpClient: container.httpClient,
    readApiKey: container.readApiKey,
    verbose: flags.verbose,
    dryRun: flags.dryRun,
    previousResults: new Map()
  });

  let currentCategory = "";
  for (const { check, result: checkResult } of result.checks) {
    if (check.category !== currentCategory) {
      currentCategory = check.category;
      resources.logger.info(formatCategory(currentCategory));
    }
    logCheckResult(resources.logger, check.description, checkResult);
    if (flags.verbose && checkResult.detail) {
      resources.logger.verbose(`  ${checkResult.detail}`);
    }
  }

  const { summary } = result;
  const parts: string[] = [];
  if (summary.pass > 0) parts.push(`${summary.pass} passed`);
  if (summary.warn > 0) parts.push(`${summary.warn} warnings`);
  if (summary.fail > 0) parts.push(`${summary.fail} failed`);
  if (summary.skip > 0) parts.push(`${summary.skip} skipped`);
  resources.logger.resolved("Summary", parts.join(", "));

  resources.context.finalize();
  return result;
}

function formatCategory(category: string): string {
  if (category === "system") return "System";
  if (category === "auth") return "Authentication";
  if (category.startsWith("agent:")) {
    return `Agent: ${category.slice("agent:".length)}`;
  }
  if (category.startsWith("mcp:")) {
    return `MCP: ${category.slice("mcp:".length)}`;
  }
  return category;
}

function logCheckResult(
  logger: ScopedLogger,
  description: string,
  result: CheckResult
): void {
  const fixSuffix = result.fix ? ` — ${result.fix}` : "";
  if (result.status === "pass") {
    logger.success(`${description}: ${result.message}`);
    return;
  }
  if (result.status === "warn") {
    logger.warn(`${description}: ${result.message}${fixSuffix}`);
    return;
  }
  if (result.status === "fail") {
    logger.error(`${description}: ${result.message}${fixSuffix}`);
    return;
  }
  // skip
  logger.info(`${description}: ${result.message}`);
}
