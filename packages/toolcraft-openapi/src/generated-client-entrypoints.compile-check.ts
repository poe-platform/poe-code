import { S, defineGroup } from "toolcraft";
import { runCLI, type RunCLIOptions } from "toolcraft/cli";
import { runMCP, type RunMCPOptions } from "toolcraft/mcp";
import {
  defineApiCommand,
  defineClient,
  type DefineClientOptions,
  type OpenApiClientServices
} from "./index.js";

const generatedCommands = [
  defineGroup({
    name: "widgets",
    children: [
      defineApiCommand({
        name: "list",
        scope: ["cli", "mcp", "sdk"] as const,
        params: S.Object({}),
        handler: async () => ({ ok: true })
      })
    ]
  })
] as const;

type GeneratedClientOptions = Omit<DefineClientOptions<object>, "commands">;

function defineGeneratedClient(options: GeneratedClientOptions) {
  return defineClient<object>({
    ...options,
    commands: [...generatedCommands]
  });
}

type GeneratedCLIOptions = GeneratedClientOptions &
  Omit<RunCLIOptions<OpenApiClientServices>, "services">;

async function runGeneratedCLI(options: GeneratedCLIOptions) {
  const client = defineGeneratedClient(options);

  await runCLI(client.root, {
    ...options,
    services: client.services
  });
}

type GeneratedMCPOptions = GeneratedClientOptions &
  Omit<RunMCPOptions<OpenApiClientServices>, "name" | "services">;

async function runGeneratedMCP(options: GeneratedMCPOptions) {
  const client = defineGeneratedClient(options);

  await runMCP(client.root, {
    ...options,
    name: client.name,
    services: client.services
  });
}

void runGeneratedCLI;
void runGeneratedMCP;
