import {
  parseCsvRecords, CsvBudget, CsvParser, resolveColumns, serializeRow,
  cutCsv, csvcut, csvcutCommand, createCsvcutCommand, csvcutCommands, parseCsvcutArguments,
  type CsvcutInvocation, type CsvcutCommandOptions, type CsvcutResult,
  type CsvcutOptions, type CsvcutRunOptions,
  type CsvRow, type CsvDialect, type CsvcutByteSource, type CsvcutEngineOptions
} from "@poe-platform/safe-bash/commands/csvcut";

const signal = new AbortController().signal;
const dialect: CsvDialect = { profile: "utf8-sig-strict-v1", delimiter: ";" };
const options: CsvcutEngineOptions = { signal, dialect, limits: { inputBytes: 1024 } };
const source: CsvcutByteSource = async function* (signal) {
  signal.throwIfAborted();
  yield new TextEncoder().encode("a;b\n");
};
const stream: AsyncGenerator<CsvRow, void, unknown> = parseCsvRecords(source, options);
const budget = new CsvBudget({}, signal);
const parser = new CsvParser(dialect, budget);
const indices: number[] = resolveColumns({ include: "2,1", exclude: "missing" }, ["a", "b"], budget);
const record: string = serializeRow(["a", "b"], budget);
void [stream, parser, indices, record];
const selection: CsvcutOptions = { include: "2,1,2", exclude: "missing", deleteEmptyRows: true, names: false };
const runOptions: CsvcutRunOptions = { signal, limits: { outputBytes: 1024 }, registerCleanup(cleanup) { void cleanup; } };
const cut: AsyncGenerator<Uint8Array, void, unknown> = cutCsv(source, selection, runOptions);
void cut;

import type { CommandContext, CommandDefinition } from "@poe-platform/safe-bash/contracts/command";
import type { VirtualShellPlugin } from "@poe-platform/safe-bash/contracts/plugin";
const invocation: CsvcutInvocation = { include: "2,1", filePath: "/input.csv", encoding: "utf-8-sig", dialect };
const configuration: CsvcutCommandOptions = { limits: { outputBytes: 1024 }, replace: true };
const definition: CommandDefinition = createCsvcutCommand(configuration);
const plugin: VirtualShellPlugin = csvcutCommands(configuration);
const run = (context: CommandContext): Promise<CsvcutResult> => csvcut(context, invocation, configuration);
const parsed: CsvcutInvocation = parseCsvcutArguments(["-c2"], budget);
void [csvcutCommand, definition, plugin, run, parsed];
