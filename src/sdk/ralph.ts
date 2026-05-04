import {
  runRalph as runWorkspaceRalph,
  type RalphRunOptions,
  type RalphRunResult
} from "@poe-code/ralph";
import { parseAgentSpecifier } from "@poe-code/agent-defs";
import type { SpawnSession } from "./spawn-session.js";
import { createSpawnSession } from "./spawn-session.js";
import { spawn as sdkSpawn } from "./spawn.js";
import { getPoeApiKey } from "./credentials.js";

export type {
  AgentRunInput,
  AgentRunResult,
  RalphRunOptions,
  RalphRunResult,
  RalphStopReason
} from "@poe-code/ralph";

const DEFAULT_RALPH_AGENT = "claude-code";

export async function runRalph(options: RalphRunOptions): Promise<RalphRunResult> {
  if (options.runAgent || options.detach === true) {
    return await runWorkspaceRalph({
      ...options,
      runAgent: options.runAgent ?? createDefaultRalphRunAgent(options)
    });
  }

  await ensurePoeApiKey();
  const session = createRalphSpawnSession(options);
  const finishSession = createRalphSessionFinalizer(session);
  try {
    return await runWorkspaceRalph({
      ...options,
      prepareFinalWorkspace: async () => {
        await options.prepareFinalWorkspace?.();
        await finishSession();
      },
      runAgent: createSessionRalphRunAgent(session)
    });
  } finally {
    await finishSession();
  }
}

function createDefaultRalphRunAgent(
  options: RalphRunOptions
): NonNullable<RalphRunOptions["runAgent"]> {
  return async (input) =>
    await sdkSpawn.autonomous(input.agent, {
      prompt: input.prompt,
      cwd: input.cwd,
      model: input.model,
      mode: "yolo",
      ...(options.runtime ? { runtime: options.runtime } : {}),
      ...(options.runtimeImage ? { runtimeImage: options.runtimeImage } : {}),
      ...(options.runtimeTemplate ? { runtimeTemplate: options.runtimeTemplate } : {}),
      ...(options.runtimeConfigCwd ? { runtimeConfigCwd: options.runtimeConfigCwd } : {}),
      ...(options.detach ? { detach: options.detach } : {}),
      ...(options.mountPoeCode ? { mountPoeCode: options.mountPoeCode } : {}),
      ...(options.runnerSync ? { runnerSync: options.runnerSync } : {}),
      ...(input.signal ? { signal: input.signal } : {})
    });
}

function createRalphSpawnSession(options: RalphRunOptions): SpawnSession {
  const initialAgent = resolveInitialAgent(options.agent);

  return createSpawnSession({
    service: initialAgent.agent,
    cwd: options.cwd,
    ...(initialAgent.model ? { model: initialAgent.model } : {}),
    mode: "yolo",
    ...(options.runtime ? { runtime: options.runtime } : {}),
    ...(options.runtimeImage ? { runtimeImage: options.runtimeImage } : {}),
    ...(options.runtimeTemplate ? { runtimeTemplate: options.runtimeTemplate } : {}),
    ...(options.runtimeConfigCwd ? { runtimeConfigCwd: options.runtimeConfigCwd } : {}),
    ...(options.mountPoeCode ? { mountPoeCode: options.mountPoeCode } : {}),
    ...(options.runnerSync ? { runnerSync: options.runnerSync } : {}),
    downloadConflict: "overwrite",
    context: {
      homeDir: options.homeDir
    }
  });
}

function createSessionRalphRunAgent(
  session: SpawnSession
): NonNullable<RalphRunOptions["runAgent"]> {
  return async (input) =>
    await session.run({
      prompt: input.prompt,
      agent: input.agent,
      cwd: input.cwd,
      model: input.model,
      signal: input.signal,
      syncBack: false
    });
}

function createRalphSessionFinalizer(session: SpawnSession): () => Promise<void> {
  let finished = false;

  return async () => {
    if (finished) {
      return;
    }

    finished = true;
    try {
      await session.syncBack();
    } finally {
      await session.close();
    }
  };
}

function resolveInitialAgent(agent: RalphRunOptions["agent"]): { agent: string; model?: string } {
  const value = Array.isArray(agent) ? agent[0] : agent;
  const specifier = parseAgentSpecifier(value ?? DEFAULT_RALPH_AGENT);
  return {
    agent: specifier.agent,
    ...(specifier.model ? { model: specifier.model } : {})
  };
}

async function ensurePoeApiKey(): Promise<void> {
  if (process.env.POE_API_KEY && process.env.POE_API_KEY.trim().length > 0) {
    return;
  }

  process.env.POE_API_KEY = await getPoeApiKey();
}
