import { Shell, CommandRegistry, agentCommands } from "@poe-platform/safe-bash";
import type { CommandDefinition, VirtualShellPlugin, ShellOptions } from "@poe-platform/safe-bash";
import { createMemoryFileSystem, createMountFileSystem, prepareExclusiveFile } from "@poe-platform/safe-fs";
import type { ByteSource, FileSystem, FsOptions, PreparedExclusiveFile } from "@poe-platform/safe-fs";
import type { FileOutputOpenOptions } from "@poe-platform/safe-bash/contracts/filesystem-output";
import {
  Shell as OptionalShell, agentCommands as optionalAgentCommands,
  createYesCommand, createYesCommands, yesCommands,
  createCmpCommand, createCmpCommands, cmpCommands,
  createDdCommand, createDdCommands, ddCommands,
  createShufCommand, createShufCommands, shufCommands,
  createTruncateCommand, createTruncateCommands, truncateCommands,
  createInstallCommand, createInstallCommands, installCommands,
  createYqCommand, createYqCommands, yqCommands,
  createDeviceFileSystem, arraysExtension, jobsExtension, mapfileExtension, readExtension, trapExtension,
} from "@poe-platform/safe-bash-optional";
import type {
  YesCommandOptions, YesCommandsOptions, CmpCommandsOptions, CmpLimits,
  DdCommandsOptions, DdFileHandle, DdFileOpener, DdFileRequest,
  ShufCommandsOptions, TruncateCommandsOptions,
  InstallCommandsOptions, InstallModeRequest, InstallContextRequest,
  YqCommandsOptions, YqLimits, DeviceFileSystem, ReadExtensionOptions,
  TrapExtensionOptions, TrapSignalHost, ShellExtension,
  ShellBindingReference, ShellBindingResult, ShellExtensionContext, ShellExecutionCheckpoint,
  PreparedShellChild, ShellChildPreparation, ShellListTerminatorContext,
} from "@poe-platform/safe-bash-optional";
import type {
  ShellExtension as HostExtension, ShellExtensionContext as HostContext,
  ShellBindingReference as HostReference, ShellIndexedWriter, ShellInputBorrow, ShellInputObserver,
  RawRecord, ReadLine,
} from "@poe-platform/safe-bash/optional-host";

type Same<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Condition extends true> = Condition;
type PublicExtension = NonNullable<ShellOptions["extensions"]>[number];
export type InstalledIdentity = [
  Assert<Same<typeof Shell, typeof OptionalShell>>,
  Assert<Same<typeof agentCommands, typeof optionalAgentCommands>>,
  Assert<Same<ShellExtension, HostExtension>>,
  Assert<Same<ShellExtension, PublicExtension>>,
  Assert<Same<ShellExtensionContext, HostContext>>,
  Assert<Same<ShellBindingReference, HostReference>>,
];
export type InstalledOptions = [
  YesCommandOptions, YesCommandsOptions, CmpCommandsOptions, CmpLimits,
  DdCommandsOptions, DdFileHandle, DdFileOpener, DdFileRequest,
  ShufCommandsOptions, TruncateCommandsOptions, InstallCommandsOptions,
  InstallModeRequest, InstallContextRequest, YqCommandsOptions, YqLimits,
  DeviceFileSystem, ReadExtensionOptions, TrapExtensionOptions, TrapSignalHost,
  ShellBindingResult<void>, PreparedShellChild, ShellChildPreparation,
  ShellListTerminatorContext, ShellIndexedWriter, ShellInputBorrow, ShellInputObserver,
  RawRecord, ReadLine,
];

export async function installedOptionalConsumer(signalHost: TrapSignalHost): Promise<void> {
  const definitions: readonly CommandDefinition[] = [
    createYesCommand(), createCmpCommand(), createDdCommand(), createShufCommand(),
    createTruncateCommand(), createInstallCommand(), createYqCommand(),
    ...createYesCommands(), ...createCmpCommands(), ...createDdCommands(), ...createShufCommands(),
    ...createTruncateCommands(), ...createInstallCommands(), ...createYqCommands(),
  ];
  const registry = new CommandRegistry();
  for (const definition of definitions) registry.register(definition, { replace: true });
  const plugins: readonly VirtualShellPlugin[] = [
    yesCommands(), cmpCommands(), ddCommands(), shufCommands(), truncateCommands(),
    installCommands(), yqCommands(),
  ];
  const devices: DeviceFileSystem = createDeviceFileSystem();
  const fs: FileSystem = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": devices } });
  const readOptions: ReadExtensionOptions = { nonTerminalInput: true };
  const trapOptions: TrapExtensionOptions = { signalNames: { SIGUSR1: 30 }, signalHost };
  const extensions: readonly ShellExtension[] = [arraysExtension(), jobsExtension(), mapfileExtension(), readExtension(readOptions), trapExtension(trapOptions)];
  const shell = new Shell({ fs, extensions }).use(agentCommands());
  try {
    for (const plugin of plugins) shell.use(plugin);
    const output: Uint8Array = (await shell.exec("yes typed | head -n1")).stdoutBytes;
    void output;
  } finally { await shell.dispose(); }
}

export const checkpointPoints: readonly ShellExecutionCheckpoint[] = ["loop-body-complete", "child-job-install", "source-input-read"];
export const indexedSyntax: NonNullable<ShellExtension["syntax"]> = { indexedElementOperators: true };
export const optionalWaitBridge: Pick<ShellExtensionContext, "interruptWait" | "waitInterruptibly"> = {};
export async function installedWaitBridge(context: ShellExtensionContext): Promise<number | undefined> {
  const accepted: boolean | undefined = context.interruptWait?.(158);
  void accepted;
  const result = await context.waitInterruptibly?.(async signal => { signal.throwIfAborted(); return { childStatus: 7 }; });
  if (result?.kind === "completed") {
    const value: { childStatus: number } = result.value;
    return value.childStatus;
  }
  if (result?.kind === "interrupted") return result.status;
  return undefined;
}

export type InstalledExclusiveFileIdentity = [
  Assert<Same<ReturnType<typeof prepareExclusiveFile>, PreparedExclusiveFile>>,
  Assert<Same<PreparedExclusiveFile["createStream"], (source: ByteSource, options?: FsOptions) => Promise<void>>>,
  Assert<Same<PreparedExclusiveFile["retain"], () => Promise<void>>>,
  Assert<Same<NonNullable<FileOutputOpenOptions["createExclusiveStream"]>, (source: ByteSource, options: FsOptions) => Promise<void>>>,
];

export async function installedExclusiveFileConsumer(fs: FileSystem, source: ByteSource, signal: AbortSignal): Promise<void> {
  const owner: PreparedExclusiveFile = prepareExclusiveFile(fs, "/stage", { mode: 0o600, signal });
  try {
    const createExclusiveStream: NonNullable<FileOutputOpenOptions["createExclusiveStream"]> = owner.createStream;
    const options: FileOutputOpenOptions = { flag: "wx", mode: 0o600, createExclusiveStream };
    await createExclusiveStream(source, { signal });
    const retained: Promise<void> = owner.retain();
    await retained;
    void options;
  } finally { await owner.close(); }
}
