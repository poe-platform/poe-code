import type { AsyncCommandHandler, CommandContext, CommandHandler, CommandRegistry, CommandResult } from "./command.js";
import type { FileSystemFactory } from "./filesystem.js";

export type Next = () => Promise<CommandResult>;

export type Middleware = (
  context: CommandContext,
  next: Next,
) => CommandResult | Promise<CommandResult>;

export interface PluginHost {
  readonly commands: CommandRegistry;
  use(middleware: Middleware): void;
  registerFileSystem(scheme: string, factory: FileSystemFactory): void;
}

export interface VirtualShellPlugin {
  readonly name: string;
  setup(host: PluginHost): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export function composeMiddleware(
  middleware: readonly Middleware[],
  terminal: CommandHandler,
): AsyncCommandHandler {
  const stack = [...middleware];
  return async (context) => {
    let lastIndex = -1;
    const dispatch = async (index: number): Promise<CommandResult> => {
      if (index <= lastIndex) throw new Error("next() may only be called once per middleware");
      lastIndex = index;
      context.signal.throwIfAborted();
      const handler = stack[index];
      return handler ? handler(context, () => dispatch(index + 1)) : terminal(context);
    };
    return dispatch(0);
  };
}
