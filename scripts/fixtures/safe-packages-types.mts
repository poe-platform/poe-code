import "./safe-packages-portable-search-types.mjs";
import { agentCommands, createAgentCommands, createBoundedRegexProvider, createZipCommand, createUnzipCommand, type AgentCommandsOptions, type ArchiveCommandsOptions, type CsplitCommandsOptions } from "@poe-platform/safe-bash";
import { createCsplitCommand } from "@poe-platform/safe-bash/commands/csplit";
import { createPrCommand, createPrCommands, prCommands, type PrCommandsOptions, type PrLimits } from "@poe-platform/safe-bash";
import { createPrCommand as createSubpathPrCommand, createPrCommands as createSubpathPrCommands, prCommands as subpathPrCommands, type PrCommandsOptions as SubpathPrCommandsOptions, type PrLimits as SubpathPrLimits } from "@poe-platform/safe-bash/commands/pr";
import { createTsortCommand, createTsortCommands, tsortCommands, type TsortCommandsOptions, type TsortLimits } from "@poe-platform/safe-bash";
import { createFactorCommand, createFactorCommands, factorCommands, type FactorCommandsOptions, type FactorLimits } from "@poe-platform/safe-bash";
import { createGetoptCommand, createGetoptCommands, getoptCommands, type GetoptCommandsOptions, type GetoptLimits } from "@poe-platform/safe-bash";
import { createHexdumpCommand, createHdCommand, createHexdumpCommands, hexdumpCommands, type HexdumpCommandsOptions, type HexdumpLimits } from "@poe-platform/safe-bash";
import { createTsortCommand as createSubpathTsortCommand, createTsortCommands as createSubpathTsortCommands, tsortCommands as subpathTsortCommands, type TsortCommandsOptions as SubpathTsortCommandsOptions, type TsortLimits as SubpathTsortLimits } from "@poe-platform/safe-bash/commands/tsort";
import { createFactorCommand as createSubpathFactorCommand, createFactorCommands as createSubpathFactorCommands, factorCommands as subpathFactorCommands, type FactorCommandsOptions as SubpathFactorCommandsOptions, type FactorLimits as SubpathFactorLimits } from "@poe-platform/safe-bash/commands/factor";
import { createGetoptCommand as createSubpathGetoptCommand, createGetoptCommands as createSubpathGetoptCommands, getoptCommands as subpathGetoptCommands, type GetoptCommandsOptions as SubpathGetoptCommandsOptions, type GetoptLimits as SubpathGetoptLimits } from "@poe-platform/safe-bash/commands/getopt";
import { createHexdumpCommand as createSubpathHexdumpCommand, createHdCommand as createSubpathHdCommand, createHexdumpCommands as createSubpathHexdumpCommands, hexdumpCommands as subpathHexdumpCommands, type HexdumpCommandsOptions as SubpathHexdumpCommandsOptions, type HexdumpLimits as SubpathHexdumpLimits } from "@poe-platform/safe-bash/commands/hexdump";
import { createNodeRegexProvider } from "@poe-platform/safe-bash/node";
import { posix } from "node:path";
import { posixPath as contractPath, type CommandDefinition, type CommandInput } from "@poe-platform/safe-bash/contracts";
import { posixPath as indexedPath, type CommandInput as IndexedCommandInput } from "@poe-platform/safe-bash/contracts/index";
import { posixPath as directPath } from "@poe-platform/safe-bash/contracts/path";
import { Budget, run, makeFsModule, type RunClock, type HostObjectIndexedDefinition, type HostObjectNamedDefinition, type CallbackInvocation } from "@poe-platform/safe-js";
import { createMemoryFileSystem, OverlayFileSystem, type CapabilityQueryOptions, type FileReadHandle, type FileResizeHandle, type FileSystem, type OpenReadFileOptions, type OpenResizeFileOptions } from "@poe-platform/safe-fs/core";
import type { FileSystem as CompatibilityFileSystem } from "@poe-platform/safe-js/fs";
import { Shell, evaluateCommandSupport, type CommandSupport, type CommandFileSystemRequirement, type FileReadHandle as ShellFileReadHandle, type OpenReadFileOptions as ShellOpenReadFileOptions, type FileResizeHandle as ShellFileResizeHandle, type OpenResizeFileOptions as ShellOpenResizeFileOptions } from "@poe-platform/safe-bash";
import { createRealm, defineExtension, type HostObject, type GuestReference, type HostObjectIndexedDefinition as CoreIndexed, type HostObjectNamedDefinition as CoreNamed, type CallbackInvocation as CoreInvocation } from "@poe-platform/safe-js/core";

const fs: FileSystem & CompatibilityFileSystem = createMemoryFileSystem();
const readOptions: OpenReadFileOptions & ShellOpenReadFileOptions = { allowDirectory: true };
const directoryQuery: CapabilityQueryOptions = readOptions;
await new OverlayFileSystem({ upper: createMemoryFileSystem(), lower: createMemoryFileSystem() }).capabilitiesFor("/", { allowDirectory: true });
void directoryQuery;
const resizeOptions: OpenResizeFileOptions & ShellOpenResizeFileOptions = { create: true, mode: 0o640 };
const capabilityQuery: CapabilityQueryOptions = { create: false };
const retainedResize: boolean | undefined = (await fs.capabilitiesFor?.("/typed", capabilityQuery))?.retainedResize;
const resizing: Promise<FileResizeHandle & ShellFileResizeHandle> | undefined = fs.openResizeFile?.("/typed", resizeOptions);
const reading: Promise<FileReadHandle & ShellFileReadHandle> | undefined = fs.openReadFile?.("/typed");
for (const acquired of [resizing, reading]) {
  const handle = await acquired;
  if (!handle) continue;
  const hint: number | undefined = (await handle.stat()).preferredIoBlockSize;
  const offset: bigint | undefined = await handle.seekEnd?.();
  if ("truncate" in handle) await handle.truncate(0);
  else await handle.read(0, 1);
  await handle.close();
  void hint;
  void offset;
}
void retainedResize;
const nodePaths: readonly (typeof posix)[] = [contractPath, indexedPath, directPath];
for (const paths of nodePaths) {
  const formatted: string = paths.format(paths.parse(paths.resolve("/workspace", "file.txt")));
  void formatted;
}
const agentOptions: AgentCommandsOptions = { regexExecutor: createBoundedRegexProvider(), regex: { maxWorkers: 1 } };
const archiveOptions: ArchiveCommandsOptions = { limits: { maxMembers: 100 } };
const zipCommands: readonly CommandDefinition[] = [createZipCommand(archiveOptions), createUnzipCommand(archiveOptions)];
void zipCommands;
const csplitOptions: CsplitCommandsOptions = { limits: { maxFiles: 16 } };
const csplitCommand: CommandDefinition = createCsplitCommand(csplitOptions);
void csplitCommand;
const prLimits: Partial<PrLimits> & Partial<SubpathPrLimits> = { maxFiles: 4, maxInputBytes: 4096, maxOutputBytes: 8192, maxWork: 65536 };
const prOptions: PrCommandsOptions & SubpathPrCommandsOptions = { clock: () => Date.UTC(2026, 0, 2, 3, 4), limits: prLimits };
const prCommand: CommandDefinition = createPrCommand(prOptions);
const prDefinitions: readonly CommandDefinition[] = createPrCommands(prOptions);
const prPlugin: ReturnType<typeof prCommands> = prCommands(prOptions);
const prFactory: typeof createPrCommand = createSubpathPrCommand;
const prFactories: typeof createPrCommands = createSubpathPrCommands;
const prPluginFactory: typeof prCommands = subpathPrCommands;
void prCommand;
void prDefinitions;
void prPlugin;
void prFactory;
void prFactories;
void prPluginFactory;
const tsortLimits: Partial<TsortLimits> & Partial<SubpathTsortLimits> = { maxNodes: 32 };
const tsortOptions: TsortCommandsOptions & SubpathTsortCommandsOptions = { limits: tsortLimits, replace: true };
const tsortCommand: CommandDefinition = createTsortCommand(tsortOptions);
const tsortDefinitions: readonly CommandDefinition[] = createTsortCommands(tsortOptions);
const tsortPlugin: ReturnType<typeof tsortCommands> = tsortCommands(tsortOptions);
const tsortFactory: typeof createTsortCommand = createSubpathTsortCommand;
const tsortFactories: typeof createTsortCommands = createSubpathTsortCommands;
const tsortPluginFactory: typeof tsortCommands = subpathTsortCommands;
void tsortCommand;
void tsortDefinitions;
void tsortPlugin;
void tsortFactory;
void tsortFactories;
void tsortPluginFactory;
const factorLimits: Partial<FactorLimits> & Partial<SubpathFactorLimits> = { maxValue: 4294967295 };
const factorOptions: FactorCommandsOptions & SubpathFactorCommandsOptions = { limits: factorLimits, replace: true };
const factorCommand: CommandDefinition = createFactorCommand(factorOptions);
const factorDefinitions: readonly CommandDefinition[] = createFactorCommands(factorOptions);
const factorPlugin: ReturnType<typeof factorCommands> = factorCommands(factorOptions);
const factorFactory: typeof createFactorCommand = createSubpathFactorCommand;
const factorFactories: typeof createFactorCommands = createSubpathFactorCommands;
const factorPluginFactory: typeof factorCommands = subpathFactorCommands;
void factorCommand;
void factorDefinitions;
void factorPlugin;
void factorFactory;
void factorFactories;
void factorPluginFactory;
const getoptLimits: Partial<GetoptLimits> & Partial<SubpathGetoptLimits> = { maxWork: 8388608, maxLongOptions: 32 };
const getoptOptions: GetoptCommandsOptions & SubpathGetoptCommandsOptions = { limits: getoptLimits, replace: true };
const getoptCommand: CommandDefinition = createGetoptCommand(getoptOptions);
const getoptDefinitions: readonly CommandDefinition[] = createGetoptCommands(getoptOptions);
const getoptPlugin: ReturnType<typeof getoptCommands> = getoptCommands(getoptOptions);
const getoptGetopty: typeof createGetoptCommand = createSubpathGetoptCommand;
const getoptGetopties: typeof createGetoptCommands = createSubpathGetoptCommands;
const getoptPluginGetopty: typeof getoptCommands = subpathGetoptCommands;
void getoptCommand;
void getoptDefinitions;
void getoptPlugin;
void getoptGetopty;
void getoptGetopties;
void getoptPluginGetopty;
const commandNames: readonly string[] = createAgentCommands(agentOptions).map(command => command.name);
void commandNames;
const inputCommand: CommandDefinition = {
  name: "typed-input",
  async execute(context) {
    const destination: string | undefined = context.stdoutFile?.path;
    void destination;
    if (!context.stdinInput) return { exitCode: 0 };
    const input: CommandInput & IndexedCommandInput = context.stdinInput;
    const position: number = input.position;
    const size: number | undefined = input.stat?.size;
    void size;
    await input.seek?.(position, context.signal);
    const result: IteratorResult<Uint8Array> = await input.read(1, context.signal);
    if (!result.done) await context.stdout.write(result.value);
    return { exitCode: 0 };
  },
};
void inputCommand;
const agent = new Shell({ fs }).use(agentCommands(agentOptions));
await agent.dispose();
const native = new Shell({ fs }).use(agentCommands({ regexExecutor: createNodeRegexProvider() }));
await native.dispose();
const requirements: readonly CommandFileSystemRequirement[] = [{ id: "append", description: "Append file content", capabilities: ["append"], mutates: true }];
const support: CommandSupport = evaluateCommandSupport({ filesystemRequirements: requirements }, fs.capabilities);
void support;
let next = 0;
const clock: RunClock = { now: () => next++, snapshot: () => ({ next }), restore: state => { next = state.next; } };
await run("return new Date(Date.now()).toISOString();", { clock });
const shell = new Shell({ fs, limits: { maxInputBytes: 100 } }).use(agentCommands());
await run("return 1;", { budget: new Budget({ maxSteps: 100 }) });
void makeFsModule;
await shell.dispose();
const extension = defineExtension({
  manifest: { version: 1, name: "typed-consumer", capabilities: ["guest:retain"], globals: ["node", "discard", "nodes"] },
  setup(context) {
    const start: (callback: unknown) => CallbackInvocation & CoreInvocation = context.startCallback;
    void start;
    const node: HostObject = context.createHostObject({ properties: { value: { get: () => 7 } } });
    const indexed: HostObjectIndexedDefinition & CoreIndexed = { length: () => 1, get: () => node, maxLength: 8 };
    const values = new Map<string, unknown>([["node", node]]);
    const named: HostObjectNamedDefinition & CoreNamed = { keys: () => [...values.keys()], get: name => values.get(name), set: (name, value) => { values.set(name, value); }, delete: name => values.delete(name), maxKeys: 8, maxKeyCodeUnits: 128, enumerable: false };
    const nodes = context.createHostObject({ indexed, named });
    const discard = context.retainGuestArguments((reference: GuestReference) => context.releaseGuestReference(reference), 0);
    return { globals: { node, discard, nodes } };
  }
});
const realm = createRealm({ extensions: [extension], grants: ["guest:retain"], clock, limits: { callbacks: 10, guestReferences: 10 } });
const start: (callback: unknown) => CallbackInvocation & CoreInvocation = realm.startCallback;
void start;
await realm.evaluate("discard({}); return [node.value, nodes[0] === node, nodes.node === node];");
await realm.close();
const consoleExtension = defineExtension({
  manifest: { version: 1, name: "owned-console", globals: ["console"] },
  setup(context) { return { globals: { console: context.createHostObject({ methods: { log: (...args: unknown[]) => { void args; } } }) } }; }
});
const consoleOptions = { extensions: [consoleExtension], builtinOverrides: { console: "owned-console" } };
const consoleRealm = createRealm(consoleOptions);
await consoleRealm.evaluate('console.log("typed");');
await consoleRealm.close();
await run('console.log("typed one-shot");', consoleOptions);

const hexdumpLimits: HexdumpLimits & SubpathHexdumpLimits = {
  maxArguments: 4096, maxArgumentBytes: 65536, maxInputBytes: 33554432,
  maxBufferedBytes: 8388608, maxOutputBytes: 134217728, maxDiagnosticBytes: 65536,
  maxFormats: 64, maxWork: 536870912, maxEmptyChunks: 4096,
};
const hexdumpOptions: HexdumpCommandsOptions & SubpathHexdumpCommandsOptions = { limits: hexdumpLimits, replace: true };
const hexdumpCommand: CommandDefinition = createHexdumpCommand(hexdumpOptions);
const hdCommand: CommandDefinition = createHdCommand(hexdumpOptions);
const hexdumpDefinitions: readonly CommandDefinition[] = createHexdumpCommands(hexdumpOptions);
const hexdumpPlugin: ReturnType<typeof hexdumpCommands> = hexdumpCommands(hexdumpOptions);
const hexdumpFactory: typeof createHexdumpCommand = createSubpathHexdumpCommand;
const hdFactory: typeof createHdCommand = createSubpathHdCommand;
const hexdumpFactories: typeof createHexdumpCommands = createSubpathHexdumpCommands;
const hexdumpPluginFactory: typeof hexdumpCommands = subpathHexdumpCommands;
const hexdumpAgentOptions: AgentCommandsOptions = { hexdump: { limits: hexdumpLimits } };
void hexdumpCommand;
void hdCommand;
void hexdumpDefinitions;
void hexdumpPlugin;
void hexdumpFactory;
void hdFactory;
void hexdumpFactories;
void hexdumpPluginFactory;
void createAgentCommands(hexdumpAgentOptions);

import "./safe-packages-iconv-types.mjs";

import "./safe-packages-line-endings-types.mjs";
import "./safe-packages-llm-types.mjs";
