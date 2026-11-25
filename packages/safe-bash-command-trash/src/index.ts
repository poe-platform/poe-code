import { getCommandArguments, writeText, type CommandContext, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";

export interface TrashItem { readonly item: string; readonly path: string; readonly deletionDate: string }
/** Host operations must be atomic, preserve identity and permissions, and never
 * replace a destination or fall back to destructive removal. */
export interface TrashBackend {
  put(path: string, context: CommandContext): Promise<void>;
  list(context: CommandContext): Promise<readonly TrashItem[]>;
  restore(item: string, context: CommandContext): Promise<void>;
}
export interface TrashLimits { readonly maxItems: number; readonly maxOutputBytes: number }
export interface TrashCommandsOptions {
  readonly backend?: TrashBackend;
  readonly replace?: boolean;
  readonly limits?: Partial<TrashLimits>;
}
const filesystemBackend: TrashBackend = {
  async put(path, context) {
    if (!context.fs.trashPut) throw new Error("filesystem does not support atomic trash");
    await context.fs.trashPut(path, {signal: context.signal});
  },
  async list(context) {
    if (!context.fs.trashList) throw new Error("filesystem does not support atomic trash");
    return context.fs.trashList(context.cwd, {signal: context.signal});
  },
  async restore(item, context) {
    if (!context.fs.trashRestore) throw new Error("filesystem does not support atomic trash");
    await context.fs.trashRestore(context.cwd, item, {signal: context.signal});
  },
};
export function createTrashCommand(options: TrashCommandsOptions = {}, name = "trash-put"): CommandDefinition {
  if (!["trash-put", "trash-list", "trash-restore"].includes(name)) throw new TypeError("Unknown trash command");
  const backend = options.backend ?? filesystemBackend;
  const limits = {maxItems: 10000, maxOutputBytes: 16 * 1024 * 1024, ...options.limits};
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Invalid trash limit");
  return {name, async execute(context) {
    try {
      context.signal.throwIfAborted();
      const raw = getCommandArguments(context).args;
      const args = raw[0] === "--" ? raw.slice(1) : raw;
      if (name === "trash-put") {
        if (!args.length || args.length > limits.maxItems) throw new Error("expected PATH... within item limit");
        for (const arg of args) {
          context.signal.throwIfAborted();
          if (!arg || arg.includes("\0")) throw new Error("invalid path");
          await backend.put(arg.startsWith("/") ? arg : `${context.cwd.endsWith("/") ? context.cwd : `${context.cwd}/`}${arg}`, context);
        }
      } else if (name === "trash-list") {
        if (args.length) throw new Error("usage: trash-list");
        const items = await backend.list(context);
        if (items.length > limits.maxItems) throw new Error("trash listing exceeds item limit");
        let bytes = 0;
        for (const item of items) {
          context.signal.throwIfAborted();
          const line = `${item.item}\t${item.deletionDate}\t${item.path}\n`;
          bytes += new TextEncoder().encode(line).length;
          if (bytes > limits.maxOutputBytes) throw new Error("trash listing exceeds output limit");
          await writeText(context.stdout, line);
        }
      } else {
        const item = args[0];
        if (args.length !== 1 || !item || item.includes("/") || item.includes("\0") || item === "." || item === "..") throw new Error("usage: trash-restore ITEM");
        await backend.restore(item, context);
      }
      return {exitCode: 0};
    } catch (error) {
      context.signal.throwIfAborted();
      await writeText(context.stderr, `${name}: ${error instanceof Error ? error.message : "operation failed"}\n`);
      return {exitCode: 1};
    }
  }};
}
export function createTrashCommands(options: TrashCommandsOptions = {}): readonly CommandDefinition[] {
  return ["trash-put", "trash-list", "trash-restore"].map(name => createTrashCommand(options, name));
}
export function trashCommands(options: TrashCommandsOptions = {}): VirtualShellPlugin {
  const commands = createTrashCommands(options);
  return {name: "trash-commands", setup(host) {
    if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    for (const command of commands) host.commands.register(command, {replace: options.replace ?? false});
  }};
}
