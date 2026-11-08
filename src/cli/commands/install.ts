import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  buildProviderContext,
  createExecutionResources,
  resolveCommandFlags,
  resolveServiceAdapter,
  formatServiceList,
  listServiceNames
} from "./shared.js";
import { resolveServiceArgument } from "./configure.js";
import { withSpinner } from "toolcraft-design";

export function registerInstallCommand(
  program: Command,
  container: CliContainer
): Command {
  const serviceNames = container.registry
    .list()
    .filter((service) => typeof service.install === "function");
  const serviceDescription =
    `Agent to install${formatServiceList(listServiceNames(serviceNames))}`;
  return program
    .command("install")
    .alias("i")
    .description("Install agent binary for a configured agent.")
    .argument(
      "[agent]",
      serviceDescription
    )
    .action(async (service: string | undefined) => {
      const resolved = await resolveServiceArgument(
        program,
        container,
        service,
        { action: "install" }
      );
      await executeInstall(program, container, resolved);
    });
}

export async function executeInstall(
  program: Command,
  container: CliContainer,
  service: string
): Promise<void> {
  const adapter = resolveServiceAdapter(container, service, "install");
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

  const installProvider = async (): Promise<boolean | void> =>
    await container.registry.invoke(canonicalService, "install", async (entry) => {
      if (!entry.install) {
        throw new Error(`Agent "${canonicalService}" does not support install.`);
      }
      return await entry.install(providerContext);
    });

  const installed = flags.dryRun
    ? await installProvider()
    : await withSpinner({
        message: `Installing ${adapter.label}...`,
        fn: installProvider
      });

  const dryMessage =
    canonicalService === "claude-code"
      ? `${adapter.label} install (dry run)`
      : `Dry run: would install ${adapter.label}.`;

  // Providers that report no outcome cannot tell the two apart, so the run reads as fresh.
  resources.context.complete({
    success:
      installed === false
        ? `${adapter.label} is already installed.`
        : `Installed ${adapter.label}.`,
    dry: dryMessage
  });

  resources.context.finalize();
}
