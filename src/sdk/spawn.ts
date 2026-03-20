import { getPoeApiKey } from "./credentials.js";
import { spawnCore } from "./spawn-core.js";
import { createSdkContainer } from "./container.js";
import {
  getSpawnConfig,
  spawn as spawnNonStreaming,
  spawnInteractive,
  spawnStreaming,
  renderAcpStream,
  type AcpEvent
} from "@poe-code/agent-spawn";
import type { SpawnOptions, SpawnResult } from "./types.js";

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
    try {
      await getPoeApiKey();

      if (options.interactive) {
        resolveEventsOnce(emptyEvents);
        const interactiveResult = await spawnInteractive(service, {
          prompt: options.prompt,
          cwd: options.cwd,
          model: options.model,
          mode: options.mode,
          signal: options.signal,
          args: options.args,
          ...(options.mcpServers ? { mcpServers: options.mcpServers } : {})
        });
        return {
          stdout: interactiveResult.stdout,
          stderr: interactiveResult.stderr,
          exitCode: interactiveResult.exitCode
        };
      }

      const spawnConfig = getSpawnConfig(service);
      const supportsStreaming =
        !!spawnConfig &&
        spawnConfig.kind === "cli" &&
        typeof (spawnConfig as { adapter?: unknown }).adapter === "string";

      if (supportsStreaming) {
        const { events: innerEvents, done } = spawnStreaming({
          agentId: service,
          prompt: options.prompt,
          cwd: options.cwd,
          model: options.model,
          mode: options.mode,
          args: options.args,
          signal: options.signal,
          ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
          useStdin: false
        });

        resolveEventsOnce(innerEvents);
        const final = await done;
        return {
          stdout: final.stdout,
          stderr: final.stderr,
          exitCode: final.exitCode,
          threadId: final.threadId,
          sessionId: final.sessionId ?? final.threadId
        };
      }

      if (spawnConfig && spawnConfig.kind === "cli") {
        resolveEventsOnce(emptyEvents);
        return spawnNonStreaming(service, {
          prompt: options.prompt,
          cwd: options.cwd,
          model: options.model,
          mode: options.mode,
          args: options.args,
          signal: options.signal,
          ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
          useStdin: false
        });
      }

      resolveEventsOnce(emptyEvents);

      const container = createSdkContainer({ cwd: options.cwd });
      return spawnCore(container, service, {
        prompt: options.prompt,
        cwd: options.cwd,
        model: options.model,
        mode: options.mode,
        args: options.args,
        ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
        useStdin: false
      });
    } catch (error) {
      resolveEventsOnce(emptyEvents);
      throw error;
    }
  })();

  return { events, result };
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
  return result;
};
