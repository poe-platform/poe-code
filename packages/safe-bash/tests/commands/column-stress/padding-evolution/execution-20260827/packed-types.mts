import { Shell, createMemoryFileSystem, type ByteSource, type CommandContext } from "virtual-bash";
import { columnCommands, createColumnCommand, createColumnCommands, type ColumnCommandsOptions, type ColumnLimits } from "./node_modules/virtual-bash/dist/commands/column/index.js";

const options: ColumnCommandsOptions = { replace: true, limits: { maxCells: 8, maxOutputBytes: 256, maxDiagnosticBytes: 64 } };
const host = new Shell({ fs: createMemoryFileSystem() });
host.use(columnCommands(options));
const definition = createColumnCommand(options);
const definitions = createColumnCommands(options);
const limits: Partial<ColumnLimits> = { maxSteps: 1024, maxArgumentBytes: 64, maxRows: 8 };
const input: ByteSource = { async *[Symbol.asyncIterator]() { yield new Uint8Array([97, 32, 98, 10]); } };
async function invoke(context: CommandContext) {
  await definition.execute(context);
  return host.exec("column -t", { stdin: input });
}
void definitions;
void limits;
void invoke;
