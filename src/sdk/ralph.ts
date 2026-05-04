import {
  runRalph as runWorkspaceRalph,
  type RalphRunOptions,
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

export type {
  AgentRunInput,
  AgentRunResult,
  RalphRunOptions,
  RalphRunResult,
  RalphStopReason
} from "@poe-code/ralph";

export async function runRalph(options: RalphRunOptions): Promise<RalphRunResult> {
  const reusableE2b = options.runtime === "e2b" && options.detach !== true;
  const e2bRunner = reusableE2b && !options.runAgent ? createReusableE2bRalphRunner(options) : null;
  const runAgent = options.runAgent ?? e2bRunner?.runAgent ?? createDefaultRalphRunAgent(options);

  try {
    return await runWorkspaceRalph({
      ...options,
      runAgent
    });
  } finally {
    await e2bRunner?.close();
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
      ...(input.signal ? { signal: input.signal } : {})
    });
}

function createReusableE2bRalphRunner(options: RalphRunOptions): {
  runAgent: NonNullable<RalphRunOptions["runAgent"]>;
  close(): Promise<void>;
} {
  let session: PoeCommandSession | null = null;
  let sessionFactory: unknown;
  let sessionState: ReturnType<typeof resolvePoeCommandExecution>["state"] | undefined;

  return {
    async runAgent(input) {
      await ensurePoeApiKey();
      const spawnArgs = buildSpawnArgs(input.agent, {
        prompt: input.prompt,
        model: input.model,
        mode: "yolo"
      });
      const processEnv = spawnArgs.env ? { ...process.env, ...spawnArgs.env } : process.env;
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
          mountPoeCode: options.mountPoeCode
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

async function ensurePoeApiKey(): Promise<void> {
  if (process.env.POE_API_KEY && process.env.POE_API_KEY.trim().length > 0) {
    return;
  }

  process.env.POE_API_KEY = await getPoeApiKey();
}
