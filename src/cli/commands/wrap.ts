import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { resolveCommandFlags, resolveServiceAdapter } from "./shared.js";
import { isolatedEnvRunner } from "../isolated-env-runner.js";
import { ensureIsolatedConfigForService } from "./ensure-isolated-config.js";
import { applyIsolatedEnvRepairs } from "../isolated-env.js";

export function registerWrapCommand(
  program: Command,
  container: CliContainer
): Command {
  return program
    .command("wrap")
    .description("Run an agent CLI with Poe isolated configuration.")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument("<agent>", "Agent to wrap")
    .argument("[agentArgs...]", "Arguments forwarded to the agent")
    .action(async (service: string, agentArgs: string[] = []) => {
      const requestedService = service;
      const flags = resolveCommandFlags(program);
      const adapter = resolveServiceAdapter(container, requestedService);
      const canonicalService = adapter.name;
      const isolated = adapter.isolatedEnv;
      if (!isolated) {
        throw new Error(
          `Agent "${requestedService}" does not support isolated configuration wrappers.`
        );
      }

      const argv = process.argv;
      const wrapIndex = argv.indexOf("wrap");
      const serviceIndex =
        wrapIndex >= 0 && argv[wrapIndex + 1] === requestedService
          ? wrapIndex + 1
          : argv.indexOf(requestedService);
      const startIndex = serviceIndex >= 0 ? serviceIndex + 1 : argv.length;
      let forwarded = argv.slice(startIndex);
      if (forwarded[0] === "--") {
        forwarded = forwarded.slice(1);
      }
      if (forwarded.length === 0) {
        forwarded = agentArgs;
      }

      if (isolated.requiresConfig !== false) {
        await ensureIsolatedConfigForService({
          container,
          adapter,
          service: canonicalService,
          flags,
          refresh: true
        });
      }
      await applyIsolatedEnvRepairs({
        fs: container.fs,
        env: container.env,
        providerName: adapter.name,
        isolated
      });
      await isolatedEnvRunner({
        env: container.env,
        fs: container.fs,
        providerName: adapter.name,
        isolated,
        argv: ["node", "poe-code", ...forwarded]
      });
    });
}
