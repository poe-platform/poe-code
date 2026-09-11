const models = {
  "claude-code": { env: "POE_CODE_E2E_CLAUDE_CODE_MODEL", model: "claude-sonnet-4.6" },
  codex: { env: "POE_CODE_E2E_CODEX_MODEL", model: "gpt-5.4" },
  opencode: { env: "POE_CODE_E2E_OPENCODE_MODEL", model: "gpt-5.4" },
  goose: { env: "POE_CODE_E2E_GOOSE_MODEL", model: "gpt-5.4" },
} as const;

export function resolveE2eModel(agent: keyof typeof models, env: NodeJS.ProcessEnv = process.env): string {
  const selected = models[agent];
  return env[selected.env]?.trim() || selected.model;
}

export function resolveE2eModelEnvironment(agent: keyof typeof models, model: string): Record<string, string> {
  // Goose v1.50.0 ACP reads the model from config/environment before session/new;
  // its ACP command has no --model flag. Keep this scoped to the live fixture.
  return agent === "goose" ? { GOOSE_MODEL: model } : {};
}
