import type { CommandDefinition, CommandContext, VirtualShellPlugin } from "../contracts/index.js";
import { commandRuntimeIdentity, registerDefaultExecutors } from "../contracts/command.js";

/** A static, trusted loader. Share code, never invocation context or authority. */
export function createLazyCommandLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () =>
    (pending ??= Promise.resolve()
      .then(load)
      .catch((error) => {
        pending = undefined;
        throw error;
      }));
}

export type LazyCommandMetadata = Omit<CommandDefinition, "execute" | "runtimeIdentity">;
export type LazyCommandFactory = () => readonly CommandDefinition[];

async function waitForCode<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([pending, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Factories run per invocation; only the loader's immutable code is shared. */
export function createLazyCommands(
  metadata: readonly LazyCommandMetadata[],
  load: () => Promise<LazyCommandFactory>,
  options?: unknown
): readonly CommandDefinition[] {
  let resolvedDefinitions: readonly CommandDefinition[] | undefined;
  const definitions = Object.freeze(
    metadata.map((item) =>
      Object.freeze({
        ...item,
        runtimeIdentity: commandRuntimeIdentity,
        async execute(context: CommandContext) {
          context.signal.throwIfAborted();
          if (!resolvedDefinitions) {
            const factory = await waitForCode(load(), context.signal);
            context.signal.throwIfAborted();
            resolvedDefinitions = factory();
          }
          const definition = resolvedDefinitions.find((command) => command.name === item.name);
          if (!definition) throw new Error(`Lazy command loader did not provide ${item.name}`);
          return definition.execute(context);
        }
      })
    )
  );
  return registerDefaultExecutors(definitions, options);
}

export function lazyCommandPlugin(
  name: string,
  commands: readonly CommandDefinition[],
  replace = false
): VirtualShellPlugin {
  return {
    name,
    setup(host) {
      if (!replace)
        for (const command of commands) {
          const existing = host.commands.get(command.name);
          if (existing && !(command.fallback && !existing.fallback))
            throw new Error(`Command already registered: ${command.name}`);
        }
      for (const command of commands) host.commands.register(command, { replace });
    }
  };
}
