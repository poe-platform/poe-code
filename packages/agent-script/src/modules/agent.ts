export type AgentSpawnMode = "read" | "edit" | "yolo";

export type AgentModuleMcpServer = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
};

export type AgentModuleMcpConfig = Record<string, AgentModuleMcpServer>;

export type AgentModuleDefinition =
  | string
  | {
      agent: string;
      prompt?: string;
      model?: string;
      mode?: AgentSpawnMode;
      cwd?: string;
      mcp?: AgentModuleMcpConfig;
    };

export type AgentModuleSpawnOptions = {
  prompt: string;
  mcp?: AgentModuleMcpConfig;
  model?: string;
  mode?: AgentSpawnMode;
  cwd?: string;
  timeoutMs?: number;
};

export type SpawnAgentInput = AgentModuleSpawnOptions & {
  agent: string;
};

export type SpawnAgentResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  summary: string;
  durationMs: number;
};

export type SpawnAgent = (input: SpawnAgentInput) => Promise<SpawnAgentResult>;

export function makeAgentModule(spawnAgent: SpawnAgent): {
  spawn(
    agentDef: AgentModuleDefinition,
    options: AgentModuleSpawnOptions
  ): Promise<SpawnAgentResult>;
} {
  return {
    async spawn(agentDef, options) {
      const input = resolveSpawnInput(agentDef, options);
      const result = validateSpawnResult(await spawnAgent(input));

      if (result.exitCode !== 0) {
        throw new Error(createSpawnFailureMessage(result));
      }

      return result;
    }
  };
}

function resolveSpawnInput(
  agentDef: AgentModuleDefinition,
  options: AgentModuleSpawnOptions
): SpawnAgentInput {
  const definition = normalizeAgentDefinition(agentDef);
  const normalizedOptions = normalizeSpawnOptions(options);

  return {
    agent: definition.agent,
    prompt: prependSystemPrompt(definition.prompt, normalizedOptions.prompt),
    ...(normalizedOptions.model ?? definition.model
      ? { model: normalizedOptions.model ?? definition.model }
      : {}),
    ...(normalizedOptions.mode ?? definition.mode
      ? { mode: normalizedOptions.mode ?? definition.mode }
      : {}),
    ...(normalizedOptions.cwd ?? definition.cwd ? { cwd: normalizedOptions.cwd ?? definition.cwd } : {}),
    ...(normalizedOptions.mcp ?? definition.mcp ? { mcp: normalizedOptions.mcp ?? definition.mcp } : {}),
    ...(normalizedOptions.timeoutMs !== undefined ? { timeoutMs: normalizedOptions.timeoutMs } : {})
  };
}

function normalizeAgentDefinition(
  agentDef: AgentModuleDefinition | unknown
): Exclude<AgentModuleDefinition, string> {
  if (typeof agentDef === "string") {
    return {
      agent: readRequiredAgent(agentDef)
    };
  }

  if (!isRecord(agentDef)) {
    throw new Error("Agent definition must be a string or object.");
  }

  return {
    agent: readRequiredAgent(agentDef.agent),
    ...(agentDef.prompt === undefined
      ? {}
      : { prompt: readOptionalString(agentDef.prompt, "Agent definition prompt") }),
    ...(agentDef.model === undefined
      ? {}
      : { model: readOptionalString(agentDef.model, "Agent definition model") }),
    ...(agentDef.mode === undefined
      ? {}
      : { mode: readSpawnMode(agentDef.mode, "Agent definition mode") }),
    ...(agentDef.cwd === undefined ? {} : { cwd: readOptionalString(agentDef.cwd, "Agent definition cwd") }),
    ...(agentDef.mcp === undefined ? {} : { mcp: readMcpConfig(agentDef.mcp, "Agent definition mcp") })
  };
}

function normalizeSpawnOptions(options: AgentModuleSpawnOptions | unknown): AgentModuleSpawnOptions {
  if (!isRecord(options)) {
    throw new Error("Agent spawn options must be an object.");
  }

  return {
    prompt: readRequiredPrompt(options.prompt),
    ...(options.model === undefined ? {} : { model: readOptionalString(options.model, "Agent spawn options model") }),
    ...(options.mode === undefined ? {} : { mode: readSpawnMode(options.mode, "Agent spawn options mode") }),
    ...(options.cwd === undefined ? {} : { cwd: readOptionalString(options.cwd, "Agent spawn options cwd") }),
    ...(options.mcp === undefined ? {} : { mcp: readMcpConfig(options.mcp, "Agent spawn options mcp") }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: readNonNegativeFiniteNumber(options.timeoutMs, "Agent spawn options timeoutMs") })
  };
}

function validateSpawnResult(result: unknown): SpawnAgentResult {
  if (!isRecord(result)) {
    throw new Error("spawnAgent must resolve to an object result.");
  }

  return {
    exitCode: readFiniteNumber(result.exitCode, "spawnAgent result exitCode"),
    stdout: readOptionalString(result.stdout, "spawnAgent result stdout") ?? "",
    stderr: readOptionalString(result.stderr, "spawnAgent result stderr") ?? "",
    summary: readOptionalString(result.summary, "spawnAgent result summary") ?? "",
    durationMs: readNonNegativeFiniteNumber(result.durationMs, "spawnAgent result durationMs")
  };
}

function prependSystemPrompt(systemPrompt: string | undefined, userPrompt: string): string {
  if (systemPrompt === undefined || systemPrompt.trim().length === 0) {
    return userPrompt;
  }

  return `${systemPrompt}\n\n# Task\n\n${userPrompt}`;
}

function createSpawnFailureMessage(result: SpawnAgentResult): string {
  const stderr = result.stderr.trim();
  const summary = result.summary.trim();
  return stderr.length > 0
    ? `Agent spawn failed with exit code ${result.exitCode}: ${stderr}`
    : summary.length > 0
      ? `Agent spawn failed with exit code ${result.exitCode}: ${summary}`
      : `Agent spawn failed with exit code ${result.exitCode}.`;
}

function readRequiredAgent(value: unknown): string {
  const agent = readOptionalString(value, "Agent definition agent")?.trim();

  if (agent === undefined || agent.length === 0) {
    throw new Error("Agent definition must define a non-empty agent.");
  }

  return agent;
}

function readRequiredPrompt(value: unknown): string {
  const prompt = readOptionalString(value, "Agent spawn options prompt");

  if (prompt === undefined || prompt.trim().length === 0) {
    throw new Error("Agent spawn options must define a non-empty prompt.");
  }

  return prompt;
}

function readSpawnMode(value: unknown, label: string): AgentSpawnMode {
  if (value === "read" || value === "edit" || value === "yolo") {
    return value;
  }

  throw new Error(`${label} must be one of: read, edit, yolo.`);
}

function readMcpConfig(value: unknown, label: string): AgentModuleMcpConfig {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const entries = Object.entries(value).map(([name, server]) => [name, readMcpServer(server, `${label}.${name}`)] as const);
  return Object.fromEntries(entries) as AgentModuleMcpConfig;
}

function readMcpServer(value: unknown, label: string): AgentModuleMcpServer {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return {
    command: readNonEmptyString(value.command, `${label}.command`),
    ...(value.args === undefined ? {} : { args: readStringArray(value.args, `${label}.args`) }),
    ...(value.env === undefined ? {} : { env: readStringRecord(value.env, `${label}.env`) }),
    ...(value.timeout === undefined ? {} : { timeout: readPositiveFiniteNumber(value.timeout, `${label}.timeout`) })
  };
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }

  return [...value];
}

function readStringRecord(value: unknown, label: string): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const entries = Object.entries(value);

  if (entries.some(([, entry]) => typeof entry !== "string")) {
    throw new Error(`${label} must be a string record.`);
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function readNonEmptyString(value: unknown, label: string): string {
  const text = readOptionalString(value, label);

  if (text === undefined || text.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return text;
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}

function readNonNegativeFiniteNumber(value: unknown, label: string): number {
  const number = readFiniteNumber(value, label);

  if (number < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }

  return number;
}

function readPositiveFiniteNumber(value: unknown, label: string): number {
  const number = readFiniteNumber(value, label);

  if (number <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }

  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
