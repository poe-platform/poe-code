import {
  csvgrep,
  createCsvgrepCommand,
  csvgrepCommands,
  CsvError,
  type CsvgrepOptions,
  type CsvgrepCommandOptions,
  type CsvgrepResult,
  type CsvLimits,
  type CsvDialect
} from "@poe-platform/safe-bash/commands/csvgrep";
import type {
  CommandContext,
  CommandDefinition,
  VirtualShellPlugin
} from "@poe-platform/safe-bash/contracts";
const limits: Partial<CsvLimits> = {
  inputBytes: 10000,
  patternBytes: 100,
  scannedCells: 100,
  work: 100000
};
const dialect: CsvDialect = { tabs: true, skipLines: 1 };
const options: CsvgrepOptions = {
  columns: "x,y",
  match: "a",
  any: true,
  invert: false,
  dialect,
  filePath: "/input"
};
const configuration: CsvgrepCommandOptions = { limits, replace: false };
const command: CommandDefinition = createCsvgrepCommand(configuration);
const plugin: VirtualShellPlugin = csvgrepCommands(configuration);
async function run(context: CommandContext): Promise<CsvgrepResult> {
  return csvgrep(context, options, configuration);
}
void command;
void plugin;
void run;
void new CsvError("LIMIT", "limit");
