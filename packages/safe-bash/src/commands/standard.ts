import { PublicDiagnostic } from "../diagnostics.js";
import { type CommandDefinition, type CommandHandler } from "../contracts/index.js";
import { basicCommands } from "./basic.js";
import { filesystemCommands } from "./filesystem.js";
import { streamCommands } from "./streams.js";
import { textCommands } from "./text.js";
import { predicateCommands } from "./predicates.js";
import { directExecutor, executionCommands, type ExecutionCommandsOptions } from "./execution.js";
import { findCommands } from "./find.js";
import { cmpCommand } from "./cmp.js";
import { fmtCommand } from "./fmt.js";
import { shufCommand } from "./shuf.js";
import { numfmtCommand } from "./numfmt.js";
import { builtInDirectContextExecutors, diagnostic } from "./internal.js";
import type { RegexExecutionOptions } from "./regex-execution/protocol.js";
import type { BoundedRegexProvider } from "./regex-execution/provider.js";

export type { ExecutionCommandsOptions } from "./execution.js";

export interface StandardCommandsOptions {
  readonly predicateIdentity?: Parameters<typeof predicateCommands>[0];
  readonly execution?: ExecutionCommandsOptions;
  readonly execute?: CommandHandler;
  readonly replace?: boolean;
  readonly regex?: RegexExecutionOptions;
  readonly regexExecutor?: BoundedRegexProvider;
  readonly maxDirectoryEntries?: number;
  readonly maxTeeTargets?: number;
  readonly maxTailFollowHandles?: number;
}

let defaultBaseStandardCommands: readonly CommandDefinition[] | undefined;
let defaultTailStandardCommands: readonly CommandDefinition[] | undefined;

export function createStandardCommandsWithGrep(options: StandardCommandsOptions, grep: readonly CommandDefinition[]): readonly CommandDefinition[] {
  const commands: CommandDefinition[] = [];
  const execute = directExecutor(options.execute ?? (async context => {
    const command = commands.find(definition => definition.name === context.command);
    if (command) return command.execute(context);
    await diagnostic(context, new PublicDiagnostic("command not found"));
    return { exitCode: 127 };
  }));
  if (
    options.maxDirectoryEntries === undefined &&
    options.maxTeeTargets === undefined &&
    options.maxTailFollowHandles === undefined &&
    options.predicateIdentity === undefined
  ) {
    defaultBaseStandardCommands ??= Object.freeze([
      ...basicCommands(),
      ...filesystemCommands(undefined),
      ...streamCommands(undefined, undefined),
      ...textCommands(),
    ]);
    defaultTailStandardCommands ??= Object.freeze([
      ...predicateCommands(undefined),
      cmpCommand(),
      fmtCommand(),
      shufCommand(),
      numfmtCommand(),
    ]);
    commands.push(
      ...defaultBaseStandardCommands,
      ...grep,
      ...defaultTailStandardCommands,
      ...executionCommands(execute, options.execution),
      ...findCommands(execute, undefined),
    );
    for (let i = 0; i < commands.length; i++) builtInDirectContextExecutors.add(commands[i]!.execute);
    return commands;
  }
  commands.push(...basicCommands(), ...filesystemCommands(options.maxDirectoryEntries), ...streamCommands(options.maxTeeTargets, options.maxTailFollowHandles), ...textCommands(), ...grep, ...predicateCommands(options.predicateIdentity), ...executionCommands(execute, options.execution), ...findCommands(execute, options.maxDirectoryEntries));
  commands.push(cmpCommand(), fmtCommand(), shufCommand(), numfmtCommand());
  for (let i = 0; i < commands.length; i++) builtInDirectContextExecutors.add(commands[i]!.execute);
  return commands;
}
