import { parse, stringify, type TomlTable } from "smol-toml";

const models = {
  "claude-code": { env: "POE_CODE_E2E_CLAUDE_CODE_MODEL", model: "claude-sonnet-4.6" },
  codex: { env: "POE_CODE_E2E_CODEX_MODEL", model: "gpt-5.4" },
  opencode: { env: "POE_CODE_E2E_OPENCODE_MODEL", model: "gpt-5.4" },
  kimi: { env: "POE_CODE_E2E_KIMI_MODEL", model: "gpt-5.4" },
  goose: { env: "POE_CODE_E2E_GOOSE_MODEL", model: "gpt-5.4" },
} as const;

export function resolveE2eModel(agent: keyof typeof models, env: NodeJS.ProcessEnv = process.env): string {
  const selected = models[agent];
  return env[selected.env]?.trim() || selected.model;
}

export function registerKimiFixtureModel(source: string, model: string, maxContextSize = 131072): string {
  const config = parse(source);
  const providers = config.providers as TomlTable | undefined;
  if (!providers?.poe) throw new Error("Configure the poe provider before registering the Kimi fixture model");
  const configured = (config.models ?? {}) as TomlTable;
  if (Object.hasOwn(configured, model)) return source;
  if (!Number.isSafeInteger(maxContextSize) || maxContextSize <= 0) throw new Error("Kimi fixture context size must be a positive integer");
  return stringify({ ...config, models: { ...configured,
    // Keep this fixture below the selected GPT-5.4 context limit; native user
    // aliases above retain their own context configuration unchanged.
    [model]: { provider: "poe", model, max_context_size: maxContextSize },
  } });
}
