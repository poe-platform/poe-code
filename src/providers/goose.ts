import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  createBinaryExistsCheck,
  createCommandExpectationCheck,
  type CommandRunnerOptions
} from "../utils/command-checks.js";
import { runServiceInstall, type ServiceInstallDefinition } from "../services/service-install.js";
import type { ProviderService, ServiceExecutionContext } from "../cli/service-registry.js";
import { DEFAULT_GOOSE_MODEL, GOOSE_MODELS } from "../cli/constants.js";
import type {
  EmptyProviderOptions,
  ModelConfigureOptions,
  ProviderSpawnOptions
} from "./spawn-options.js";
import { gooseAgent } from "@poe-code/agent-defs";

const CUSTOM_PROVIDER_ID = "custom_poe";
const CUSTOM_PROVIDER_API_KEY_ENV = "CUSTOM_POE_API_KEY";
const DEFAULT_CONTEXT_LIMIT = 128000;

export const GOOSE_INSTALL_DEFINITION: ServiceInstallDefinition = {
  id: "goose",
  summary: "Goose CLI",
  check: createBinaryExistsCheck("goose", "goose-cli-binary", "Goose CLI binary must exist"),
  steps: [
    {
      id: "install-goose-cli-unix",
      command: "sh",
      args: [
        "-c",
        "curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash"
      ],
      platforms: ["darwin", "linux"]
    },
    {
      id: "install-goose-cli-windows",
      command: "powershell",
      args: [
        "-Command",
        "irm https://github.com/block/goose/releases/download/stable/download_cli.ps1 | iex"
      ],
      platforms: ["win32"]
    }
  ],
  successMessage: "Installed Goose CLI."
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    if (isRecord(current) && isRecord(value)) {
      result[key] = deepMerge(current, value);
      continue;
    }
    result[key] = value;
  }

  return result;
}

async function readTextIfExists(
  fs: ServiceExecutionContext<unknown>["fs"],
  filePath: string
): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readYamlObject(
  fs: ServiceExecutionContext<unknown>["fs"],
  filePath: string
): Promise<Record<string, unknown>> {
  const content = await readTextIfExists(fs, filePath);
  if (!content || content.trim().length === 0) {
    return {};
  }
  const parsed = parseYaml(content);
  if (!parsed) {
    return {};
  }
  if (!isRecord(parsed)) {
    throw new Error(`Expected YAML object in ${filePath}.`);
  }
  return parsed;
}

async function readJsonObject(
  fs: ServiceExecutionContext<unknown>["fs"],
  filePath: string
): Promise<Record<string, unknown>> {
  const content = await readTextIfExists(fs, filePath);
  if (!content || content.trim().length === 0) {
    return {};
  }
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Expected JSON object in ${filePath}.`);
  }
  return parsed;
}

async function writeYamlObject(
  fs: ServiceExecutionContext<unknown>["fs"],
  filePath: string,
  value: Record<string, unknown>
): Promise<void> {
  const serialized = stringifyYaml(value);
  await fs.writeFile(filePath, serialized.endsWith("\n") ? serialized : `${serialized}\n`, {
    encoding: "utf8"
  });
}

async function writeJsonObject(
  fs: ServiceExecutionContext<unknown>["fs"],
  filePath: string,
  value: Record<string, unknown>
): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8"
  });
}

function managedExtension(
  name: "developer" | "summon",
  description: string
): Record<string, unknown> {
  return {
    enabled: true,
    type: "platform",
    name,
    description,
    display_name: name[0].toUpperCase() + name.slice(1),
    bundled: true,
    available_tools: []
  };
}

function buildManagedConfig(model: string): Record<string, unknown> {
  return {
    GOOSE_DISABLE_KEYRING: true,
    GOOSE_PROVIDER: CUSTOM_PROVIDER_ID,
    GOOSE_MODEL: model,
    extensions: {
      developer: managedExtension("developer", "Write and edit files, and execute shell commands"),
      summon: managedExtension("summon", "Load knowledge and delegate tasks to subagents")
    }
  };
}

function buildCustomProvider(baseUrl: string): Record<string, unknown> {
  return {
    name: CUSTOM_PROVIDER_ID,
    engine: "openai",
    display_name: "Poe",
    description: "Poe OpenAI-compatible API",
    api_key_env: CUSTOM_PROVIDER_API_KEY_ENV,
    base_url: `${baseUrl}/v1/chat/completions`,
    models: GOOSE_MODELS.map((name) => ({
      name,
      context_limit: DEFAULT_CONTEXT_LIMIT
    })),
    supports_streaming: true,
    requires_auth: true
  };
}

async function removeFileIfExists(
  fs: ServiceExecutionContext<unknown>["fs"],
  filePath: string
): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function createRunOptions(
  options: ProviderSpawnOptions,
  model: string
): { args: string[]; commandOptions?: CommandRunnerOptions } {
  const baseArgs = [
    "run",
    "--provider",
    CUSTOM_PROVIDER_ID,
    "--model",
    model,
    "--output-format",
    "text"
  ];

  if (options.useStdin) {
    return {
      args: [...baseArgs, "--instructions", "-", ...(options.args ?? [])],
      commandOptions: {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        stdin: options.prompt
      }
    };
  }

  return {
    args: [...baseArgs, "--text", options.prompt, ...(options.args ?? [])],
    commandOptions: options.cwd ? { cwd: options.cwd } : undefined
  };
}

export const gooseService: ProviderService<
  ModelConfigureOptions & { apiKey: string },
  EmptyProviderOptions,
  ProviderSpawnOptions
> = {
  ...gooseAgent,
  supportsStdinPrompt: true,
  configurePrompts: {
    model: {
      label: "Goose default model",
      defaultValue: DEFAULT_GOOSE_MODEL,
      choices: GOOSE_MODELS.map((id) => ({
        title: id,
        value: id
      }))
    }
  },
  async configure(context, runOptions) {
    const configDir = context.env.resolveHomePath(".config", "goose");
    const configPath = path.join(configDir, "config.yaml");
    const secretsPath = path.join(configDir, "secrets.yaml");
    const customProvidersDir = path.join(configDir, "custom_providers");
    const customProviderPath = path.join(customProvidersDir, "custom_poe.json");
    const model = context.options.model ?? DEFAULT_GOOSE_MODEL;

    await context.fs.mkdir(configDir, { recursive: true });
    await context.fs.mkdir(customProvidersDir, { recursive: true });

    const existingConfig = await readYamlObject(context.fs, configPath);
    const existingSecrets = await readYamlObject(context.fs, secretsPath);
    const existingProvider = await readJsonObject(context.fs, customProviderPath);

    await writeYamlObject(
      context.fs,
      configPath,
      deepMerge(existingConfig, buildManagedConfig(model))
    );
    await writeYamlObject(
      context.fs,
      secretsPath,
      deepMerge(existingSecrets, {
        [CUSTOM_PROVIDER_API_KEY_ENV]: context.options.apiKey
      })
    );
    await writeJsonObject(
      context.fs,
      customProviderPath,
      deepMerge(existingProvider, buildCustomProvider(context.env.poeBaseUrl))
    );

    const observer = runOptions?.observers?.onComplete;
    if (observer) {
      for (const targetPath of [configPath, customProviderPath, secretsPath]) {
        observer(
          {
            kind: "configTransform",
            label: `Update ${targetPath}`,
            targetPath
          },
          {
            changed: true,
            effect: "write",
            detail: "update"
          }
        );
      }
    }

    context.command.flushDryRun({ emitIfEmpty: false });
  },
  async unconfigure(context) {
    const configPath = context.env.resolveHomePath(".config", "goose", "config.yaml");
    const secretsPath = context.env.resolveHomePath(".config", "goose", "secrets.yaml");
    const customProviderPath = context.env.resolveHomePath(
      ".config",
      "goose",
      "custom_providers",
      "custom_poe.json"
    );

    let changed = false;

    const config = await readYamlObject(context.fs, configPath);
    for (const key of ["GOOSE_PROVIDER", "GOOSE_MODEL"]) {
      if (key in config) {
        delete config[key];
        changed = true;
      }
    }
    if (changed) {
      await writeYamlObject(context.fs, configPath, config);
    }

    const secrets = await readYamlObject(context.fs, secretsPath);
    if (CUSTOM_PROVIDER_API_KEY_ENV in secrets) {
      delete secrets[CUSTOM_PROVIDER_API_KEY_ENV];
      changed = true;
      if (Object.keys(secrets).length === 0) {
        await removeFileIfExists(context.fs, secretsPath);
      } else {
        await writeYamlObject(context.fs, secretsPath, secrets);
      }
    }

    changed = (await removeFileIfExists(context.fs, customProviderPath)) || changed;

    context.command.flushDryRun({ emitIfEmpty: false });
    return changed;
  },
  async install(context) {
    await runServiceInstall(GOOSE_INSTALL_DEFINITION, {
      isDryRun: context.logger.context.dryRun,
      runCommand: context.command.runCommand,
      logger: (message) => context.logger.verbose(message),
      platform: context.env.platform
    });
  },
  test(context) {
    const model = context.model ?? DEFAULT_GOOSE_MODEL;
    return context.runCheck(
      createCommandExpectationCheck({
        id: "goose-cli-health",
        command: "goose",
        args: [
          "run",
          "--provider",
          CUSTOM_PROVIDER_ID,
          "--model",
          model,
          "--text",
          "Reply with exactly: GOOSE_OK",
          "--output-format",
          "text"
        ],
        expectedOutput: "GOOSE_OK"
      })
    );
  },
  spawn(context, options) {
    const model = options.model ?? DEFAULT_GOOSE_MODEL;
    const { args, commandOptions } = createRunOptions(options, model);
    return commandOptions
      ? context.command.runCommand("goose", args, commandOptions)
      : context.command.runCommand("goose", args);
  }
};

export const provider = gooseService;
