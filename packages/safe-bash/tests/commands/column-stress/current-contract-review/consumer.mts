import { Shell, createMemoryFileSystem, type ByteSource, type InvocationCleanup, type Middleware } from "virtual-bash";
import { columnCommands, createColumnCommand, createColumnCommands, type ColumnCommandsOptions } from "./node_modules/virtual-bash/dist/commands/column/index.js";

const options: ColumnCommandsOptions = { replace: false, limits: { maxInputBytes: 128, maxOutputBytes: 128 } };
const shell = new Shell({ fs: createMemoryFileSystem() });
const middleware: Middleware = async (context, next) => {
  let completion: Promise<void> | undefined;
  const cleanup: InvocationCleanup = () => completion ??= Promise.resolve();
  context.registerCleanup?.(cleanup);
  try { return await next(); }
  finally { await cleanup(); }
};
shell.use(middleware);
shell.use(columnCommands(options));
const stdin: ByteSource = { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode("a b\n"); } };
void shell.exec("column -t", { stdin });
void createColumnCommand(options);
void createColumnCommands(options);
