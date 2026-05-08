import * as nodeFs from "node:fs/promises";
import os from "node:os";
import { getPoeApiKey } from "./credentials.js";
import { resolveConfiguredModel, spawnCore } from "./spawn-core.js";
import { createSdkContainer } from "./container.js";
import { spawnAutonomous, type AutonomousSpawnOptions } from "./autonomous.js";
import {
  getAcpSpawnConfig,
  getSpawnConfig,
  spawn as spawnNonStreaming,
  spawnAcp,
  spawnInteractive,
  spawnStreaming,
  renderAcpStream,
  applyMiddlewares,
  sessionCapture,
  usageCapture,
  spawnLog,
  runCommand,
  type AcpSpawnContext,
  type AcpEvent
} from "@poe-code/agent-spawn";
import { loadIntegrations, type Integrations } from "@poe-code/braintrust";
import { resolveMergedDocument } from "../cli/commands/shared.js";
import type { SpawnOptions, SpawnResult, SpawnUsage } from "./types.js";
import { resolveSpawnWorkspace } from "../workspace/resolve-spawn-workspace.js";

/**
 * Spawns an agent with optional streaming.
 *
 * Returns both:
 * - `events`: an async stream of ACP events (empty when the provider doesn't support streaming)
 * - `result`: a promise resolving to the final SpawnResult
 *
 * @example
 * ```typescript
 * import { spawn } from "poe-code"
 *
 * const { events, result } = spawn("codex", "Fix the bug in auth.ts")
 *
 * for await (const e of events) {
 *   // render or log events
 * }
 *
 * const final = await result
 * console.log(final.exitCode)
 * ```
 */
export function spawn(
  service: string,
  prompt: string,
  options?: Omit<SpawnOptions, "prompt">
): { events: AsyncIterable<AcpEvent>; result: Promise<SpawnResult> };
export function spawn(
  service: string,
  options: SpawnOptions
): { events: AsyncIterable<AcpEvent>; result: Promise<SpawnResult> };
export function spawn(
  service: string,
  promptOrOptions: string | SpawnOptions,
  maybeOptions?: Omit<SpawnOptions, "prompt">
): { events: AsyncIterable<AcpEvent>; result: Promise<SpawnResult> } {
  const options =
    typeof promptOrOptions === "string"
      ? { ...maybeOptions, prompt: promptOrOptions }
      : promptOrOptions;
  const resolvedMcpServers = options.mcpServers ?? options.mcpConfig;

  const emptyEvents: AsyncIterable<AcpEvent> = (async function* () {})();

  /**
   * Deferred event stream resolution.
   *
   * This pattern allows us to return both `events` and `result` synchronously from `spawn()`,
   * while the actual event source is determined asynchronously inside the `result` promise.
   *
   * The flow:
   * 1. Caller receives `{ events, result }` immediately
   * 2. Caller can start iterating `events` right away (iteration blocks on `eventsPromise`)
   * 3. Inside `result`, we determine if streaming is supported and resolve `eventsPromise`
   *    with either the real event stream or an empty generator
   * 4. The outer `events` generator then yields from the resolved inner stream
   *
   * This avoids forcing callers to `await` before they can set up their event handlers,
   * enabling patterns like: `for await (const e of events) { ... }` without race conditions.
   */
  let resolveEvents: ((value: AsyncIterable<AcpEvent>) => void) | undefined;
  let eventsResolved = false;
  const eventsPromise = new Promise<AsyncIterable<AcpEvent>>((resolve) => {
    resolveEvents = resolve;
  });
  const resolveEventsOnce = (value: AsyncIterable<AcpEvent>) => {
    if (eventsResolved) return;
    eventsResolved = true;
    resolveEvents?.(value);
  };

  const events: AsyncIterable<AcpEvent> = (async function* () {
    for await (const e of await eventsPromise) {
      yield e;
    }
  })();

  const result = (async (): Promise<SpawnResult> => {
    let workspace:
      | Awaited<ReturnType<typeof resolveSpawnWorkspace>>
      | undefined;
    let integrations: Integrations | null = null;

    try {
      workspace = await resolveSpawnWorkspace(options.cwd, {
        baseDir: process.cwd(),
        homeDir: os.homedir(),
        mode: options.mode,
        fs: {
          mkdir: async (target, resolveOptions) =>
            await nodeFs.mkdir(target, resolveOptions).then(() => undefined),
          stat: async (target) => await nodeFs.stat(target),
          rm: async (target, resolveOptions) => await nodeFs.rm(target, resolveOptions)
        },
        exec: runCommand
      });
      const cwd = workspace.cwd;

      const resolvedApiKey = await getPoeApiKey();
      if (!process.env.POE_API_KEY || process.env.POE_API_KEY.trim().length === 0) {
        process.env.POE_API_KEY = resolvedApiKey;
      }

      const container = createSdkContainer({ cwd });
      integrations = await loadIntegrations(await resolveMergedDocument(container));
      const middlewares = [
        sessionCapture,
        usageCapture,
        spawnLog,
        ...(integrations?.spawnMiddleware ? [integrations.spawnMiddleware] : []),
        ...(options.middlewares ?? [])
      ];
      const resolveModel = async () =>
        options.model ?? await resolveConfiguredModel(container, service);
      const runtimeOverrides = pickRuntimeOverrides(options);
      const hasRuntimeOverrides = Object.keys(runtimeOverrides).length > 0;

      if (options.interactive) {
        resolveEventsOnce(emptyEvents);
        const model = await resolveModel();
        const interactiveResult = await spawnInteractive(service, {
          prompt: options.prompt,
          cwd,
          model,
          mode: options.mode,
          signal: options.signal,
          args: options.args,
          resumeThreadId: options.resumeThreadId,
          runtimeConfigCwd: options.runtimeConfigCwd,
          ...runtimeOverrides,
          ...(resolvedMcpServers ? { mcpServers: resolvedMcpServers } : {})
        });
        return {
          stdout: interactiveResult.stdout,
          stderr: interactiveResult.stderr,
          exitCode: interactiveResult.exitCode,
          ...(interactiveResult.usage ? { usage: interactiveResult.usage } : {})
        };
      }

      const acpSpawnConfig = getAcpSpawnConfig(service);
      if (acpSpawnConfig && !hasRuntimeOverrides) {
        const model = await resolveModel();
        const { events: rawEvents, done } = spawnAcp({
          agentId: service,
          prompt: options.prompt,
          cwd: options.cwd,
          model,
          mode: options.mode,
          mcpServers: options.mcpServers,
          resumeThreadId: options.resumeThreadId,
          signal: options.signal,
          ...runtimeOverrides
        });

        const middlewareContext: AcpSpawnContext = {
          sessionId: "unknown",
          agent: service,
          logDir: options.logDir,
          logFileName: options.logFileName,
          events: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0
          },
          eventStream: rawEvents,
          prompt: options.prompt,
          model,
          mode: options.mode,
          cwd: options.cwd,
          startedAt: new Date()
        };

        await applyMiddlewares(middlewares, middlewareContext);

        resolveEventsOnce(middlewareContext.eventStream ?? emptyEvents);
        const final = await done;
        const threadId = middlewareContext.threadId ?? final.threadId;

        return {
          stdout: final.stdout,
          stderr: final.stderr,
          exitCode: final.exitCode,
          ...(threadId ? { threadId } : {}),
          ...(final.usage ? { usage: final.usage } : {}),
          ...(middlewareContext.logFile ? { logFile: middlewareContext.logFile } : {}),
          ...(middlewareContext.sessionResult ? { sessionResult: middlewareContext.sessionResult } : {})
        };
      }

      const spawnConfig = getSpawnConfig(service);
      const supportsStreaming =
        !!spawnConfig &&
        spawnConfig.kind === "cli" &&
        typeof (spawnConfig as { adapter?: unknown }).adapter === "string";

      if (supportsStreaming) {
        const model = await resolveModel();
        const { events: rawEvents, done } = spawnStreaming({
          agentId: service,
          prompt: options.prompt,
          cwd,
          model,
          mode: options.mode,
          args: options.args,
          resumeThreadId: options.resumeThreadId,
          signal: options.signal,
          runtimeConfigCwd: options.runtimeConfigCwd,
          ...runtimeOverrides,
          ...(resolvedMcpServers ? { mcpServers: resolvedMcpServers } : {}),
          ...(options.tee ? { tee: options.tee } : {}),
          ...(options.activityTimeoutMs !== undefined
            ? { activityTimeoutMs: options.activityTimeoutMs }
            : {}),
          useStdin: options.useStdin ?? false
        });

        const middlewareContext: AcpSpawnContext = {
          sessionId: "unknown",
          agent: service,
          logDir: options.logDir,
          logFileName: options.logFileName,
          events: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0
          },
          eventStream: rawEvents,
          prompt: options.prompt,
          model,
          mode: options.mode,
          cwd,
          startedAt: new Date()
        };

        await applyMiddlewares(middlewares, middlewareContext);

        resolveEventsOnce(middlewareContext.eventStream ?? emptyEvents);
        const final = await done;
        const threadId = middlewareContext.threadId ?? final.threadId;
        const usage = final.usage ?? getCapturedUsage(middlewareContext.usage);

        return {
          stdout: final.stdout,
          stderr: final.stderr,
          exitCode: final.exitCode,
          ...(threadId ? { threadId } : {}),
          ...(usage ? { usage } : {}),
          ...(middlewareContext.logFile ? { logFile: middlewareContext.logFile } : {}),
          ...(middlewareContext.sessionResult ? { sessionResult: middlewareContext.sessionResult } : {})
        };
      }

      if (spawnConfig && spawnConfig.kind === "cli") {
        resolveEventsOnce(emptyEvents);
        const model = await resolveModel();
        return spawnNonStreaming(service, {
          prompt: options.prompt,
          cwd,
          model,
          mode: options.mode,
          args: options.args,
          resumeThreadId: options.resumeThreadId,
          signal: options.signal,
          runtimeConfigCwd: options.runtimeConfigCwd,
          ...runtimeOverrides,
          ...(resolvedMcpServers ? { mcpServers: resolvedMcpServers } : {}),
          ...(options.tee ? { tee: options.tee } : {}),
          ...(options.activityTimeoutMs !== undefined
            ? { activityTimeoutMs: options.activityTimeoutMs }
            : {}),
          ...(options.logDir ? { logDir: options.logDir } : {}),
          ...(options.logFileName ? { logFileName: options.logFileName } : {}),
          useStdin: options.useStdin ?? false
        });
      }

      resolveEventsOnce(emptyEvents);

      const model = await resolveModel();
      return spawnCore(container, service, {
        prompt: options.prompt,
        cwd,
        model,
        mode: options.mode,
        args: options.args,
        resumeThreadId: options.resumeThreadId,
        ...runtimeOverrides,
        ...(resolvedMcpServers ? { mcpServers: resolvedMcpServers } : {}),
        useStdin: options.useStdin ?? false
      });
    } catch (error) {
      resolveEventsOnce(emptyEvents);
      throw error;
    } finally {
      await integrations?.shutdown();
      await workspace?.cleanup?.();
    }
  })();

  return { events, result };
}

function getCapturedUsage(usage: SpawnUsage | undefined): SpawnUsage | undefined {
  if (!usage) {
    return undefined;
  }

  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    return usage;
  }

  if (usage.cachedTokens !== undefined || usage.costUsd !== undefined) {
    return usage;
  }

  return undefined;
}

function pickRuntimeOverrides(
  options: Pick<
    SpawnOptions,
    "runtime" | "runtimeImage" | "runtimeTemplate" | "detach" | "mountPoeCode" | "runnerSync"
  >
): Pick<
  SpawnOptions,
  "runtime" | "runtimeImage" | "runtimeTemplate" | "detach" | "mountPoeCode" | "runnerSync"
> {
  return {
    ...(options.runtime ? { runtime: options.runtime } : {}),
    ...(options.runtimeImage ? { runtimeImage: options.runtimeImage } : {}),
    ...(options.runtimeTemplate ? { runtimeTemplate: options.runtimeTemplate } : {}),
    ...(options.detach ? { detach: options.detach } : {}),
    ...(options.mountPoeCode ? { mountPoeCode: options.mountPoeCode } : {}),
    ...(options.runnerSync ? { runnerSync: options.runnerSync } : {})
  };
}

/**
 * Spawns an agent and renders ACP events to stdout with pretty formatting.
 *
 * @example
 * ```typescript
 * import { spawn } from "poe-code"
 *
 * const result = await spawn.pretty("codex", "Fix the bug in auth.ts")
 * console.log(result.exitCode)
 * ```
 */
spawn.pretty = async function pretty(
  service: string,
  promptOrOptions: string | SpawnOptions,
  maybeOptions?: Omit<SpawnOptions, "prompt">
): Promise<SpawnResult> {
  const { events, result } = spawn(service, promptOrOptions as string, maybeOptions);
  await renderAcpStream(events);
  return await result;
};

spawn.autonomous = async function autonomous(
  service: string,
  promptOrOptions: string | Omit<AutonomousSpawnOptions, "service">,
  maybeOptions?: Omit<AutonomousSpawnOptions, "prompt" | "service">
): Promise<SpawnResult> {
  const options =
    typeof promptOrOptions === "string"
      ? { ...maybeOptions, prompt: promptOrOptions }
      : promptOrOptions;

  return await spawnAutonomous(spawn, {
    ...options,
    service
  });
};
