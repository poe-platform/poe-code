import {
  runRalph as runWorkspaceRalph,
  type RalphRunOptions as WorkspaceRalphRunOptions,
  type RalphRunResult
} from "@poe-code/ralph";
import {
  createPoeCommandSession,
  resolvePoeCommandExecution,
  type PoeCommandSession
} from "@poe-code/agent-harness-tools";
import { buildSpawnArgs } from "@poe-code/agent-spawn";
import { spawn as sdkSpawn } from "./spawn.js";
import { getPoeApiKey } from "./credentials.js";
import { runWithOptionalWorktree } from "./worktree.js";
import type { WorktreeExecutionOptions } from "./types.js";

export type {
  AgentRunInput,
  AgentRunResult,
  RalphRunResult,
  RalphStopReason
} from "@poe-code/ralph";

export type RalphRunOptions = WorkspaceRalphRunOptions & {
  worktree?: WorktreeExecutionOptions;
};

export async function runRalph(options: RalphRunOptions): Promise<RalphRunResult> {
  if (isWorktreeEnabled(options.worktree)) {
    const wrapped = await runWithOptionalWorktree<RalphRunResult>({
      cwd: options.cwd,
      selectedAgent: resolveWorktreeAgent(options.agent),
      worktree: options.worktree,
      signal: options.signal,
      run: async ({ worktreeCwd }) =>
        await runRalphDirect({
          ...options,
          cwd: worktreeCwd,
          worktree: false
        })
    });
    return wrapped.value;
  }

  return await runRalphDirect(options);
}

function resolveWorktreeAgent(agent: RalphRunOptions["agent"]): string {
  if (typeof agent === "string" && agent.length > 0) {
    return agent;
  }
  if (Array.isArray(agent) && typeof agent[0] === "string" && agent[0].length > 0) {
    return agent[0];
  }
  throw new Error("runRalph with worktree requires a resolved agent.");
}

async function runRalphDirect(options: RalphRunOptions): Promise<RalphRunResult> {
  const reusableE2b = options.runtime === "e2b" && options.detach !== true;
  const e2bRunner = reusableE2b && !options.runAgent ? createReusableE2bRalphRunner(options) : null;
  const runAgent = options.runAgent ?? e2bRunner?.runAgent ?? createDefaultRalphRunAgent(options);

  try {
    return await runWorkspaceRalph({
      ...options,
      runAgent
    });
  } finally {
    await e2bRunner?.close().catch(() => undefined);
  }
}

function createDefaultRalphRunAgent(
  options: RalphRunOptions
): NonNullable<WorkspaceRalphRunOptions["runAgent"]> {
  return async (input) =>
    await sdkSpawn.autonomous(input.agent, {
      prompt: input.prompt,
      cwd: input.cwd,
      model: input.model,
      mode: "yolo",
      ...(input.skills ? { skills: input.skills } : {}),
      ...(input.hooks ? { hooks: input.hooks } : {}),
      ...(input.logDir !== undefined ? { logDir: input.logDir } : {}),
      ...(input.logFileName !== undefined ? { logFileName: input.logFileName } : {}),
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

function createReusableE2bRalphRunner(options: RalphRunOptions): {
  runAgent: NonNullable<WorkspaceRalphRunOptions["runAgent"]>;
  close(): Promise<void>;
} {
  const autonomousRunAgent = createDefaultRalphRunAgent(options);
  let session: PoeCommandSession | null = null;
  let sessionFactory: unknown;
  let sessionState: ReturnType<typeof resolvePoeCommandExecution>["state"] | undefined;

  return {
    async runAgent(input) {
      if (
        input.hooks !== undefined ||
        input.skills !== undefined ||
        input.logDir !== undefined ||
        input.logFileName !== undefined
      ) {
        return autonomousRunAgent(input);
      }

      const spawnArgs = buildSpawnArgs(input.agent, {
        prompt: input.prompt,
        model: input.model,
        mode: "yolo"
      });
      const poeApiKey = process.env.POE_API_KEY?.trim() || await getPoeApiKey();
      const processEnv = { ...process.env, ...spawnArgs.env, POE_API_KEY: poeApiKey };
      const execution = resolvePoeCommandExecution({
        cwd: input.cwd,
        runtimeConfigCwd: options.runtimeConfigCwd,
        env: processEnv as Record<string, string>,
        argv: [spawnArgs.binaryName, ...spawnArgs.args],
        tool: input.agent,
        runtime: {
          runtime: options.runtime,
          runtimeImage: options.runtimeImage,
          runtimeTemplate: options.runtimeTemplate,
          mountPoeCode: options.mountPoeCode,
          runnerSync: options.runnerSync
        },
        context: {
          homeDir: options.homeDir,
          ...(sessionState ? { state: sessionState } : {})
        },
        openSpec: {
          execution: {
            wrapForLogTee: false,
            stdin: "inherit",
            stdout: "pipe",
            stderr: "pipe",
            env: processEnv as Record<string, string>,
            captureOutput: true
          }
        }
      });

      if (session === null) {
        sessionFactory = execution.factory;
        sessionState = execution.state;
        session = createPoeCommandSession({
          factory: execution.factory,
          state: execution.state
        });
      } else if (execution.factory !== sessionFactory) {
        throw new Error("Ralph e2b runtime changed during a reusable session.");
      }

      const openSpec = execution.openSpec.runner
        ? {
            ...execution.openSpec,
            runner: {
              ...execution.openSpec.runner,
              download_conflict: "overwrite" as const
            }
          }
        : execution.openSpec;
      const result = await session.run(openSpec, input.signal);
      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.exitCode
      };
    },
    async close() {
      await session?.close();
    }
  };
}

function isWorktreeEnabled(worktree: WorktreeExecutionOptions | undefined): boolean {
  return worktree === true;
}
