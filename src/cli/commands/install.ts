import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  buildProviderContext,
  createExecutionResources,
  resolveCommandFlags,
  resolveServiceAdapter
} from "./shared.js";
import { resolveServiceArgument } from "./configure.js";

export function registerInstallCommand(
  program: Command,
  container: CliContainer
): Command {
  return program
    .command("install")
    .description("Install tooling for a configured service.")
    .argument(
      "[service]",
      "Service to install (claude-code | codex | opencode)"
    )
    .action(async (service: string | undefined) => {
      const resolved = await resolveServiceArgument(
        program,
        container,
        service
      );
      await executeInstall(program, container, resolved);
    });
}

export async function executeInstall(
  program: Command,
  container: CliContainer,
  service: string
): Promise<void> {
  const adapter = resolveServiceAdapter(container, service);
  const canonicalService = adapter.name;
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(
    container,
    flags,
    `install:${canonicalService}`
  );

  resources.logger.intro(`install ${canonicalService}`);

  const providerContext = buildProviderContext(
    container,
    adapter,
    resources
  );

  await container.registry.invoke(canonicalService, "install", async (entry) => {
    if (!entry.install) {
      throw new Error(`Service "${canonicalService}" does not support install.`);
    }
    await entry.install(providerContext);
  });

  const dryMessage =
    canonicalService === "claude-code"
      ? `${adapter.label} install (dry run)`
      : `Dry run: would install ${adapter.label}.`;

  resources.context.complete({
    success: `Installed ${adapter.label}.`,
    dry: dryMessage
  });

  resources.context.finalize();
}
