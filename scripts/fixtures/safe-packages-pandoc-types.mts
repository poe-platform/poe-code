import { createPandocCommand, createPandocCommands, pandocCommands, type PandocCommandsOptions, type PandocLimits, type CommandDefinition, type VirtualShellPlugin } from "@poe-platform/safe-bash";
import { createPandocCommand as coreCommand, pandocCommands as corePlugin } from "@poe-platform/safe-bash/core";
import { convert, createPandocCommand as subpathCommand, type ConversionResult, createLuaFilterCapability, createStandalonePandocCommand, parseConversionArgs } from "@poe-platform/safe-bash/commands/pandoc";

const limits: Partial<PandocLimits> = { inputBytes: Infinity, outputBytes: 100_000 };
const options: PandocCommandsOptions = { limits, replace: true };
const commands: CommandDefinition[] = [createPandocCommand(options), coreCommand(options), subpathCommand(options), ...createPandocCommands(options)];
const plugins: VirtualShellPlugin[] = [pandocCommands(options), corePlugin(options)];
const result: ConversionResult = await convert([{ bytes: new Uint8Array() }], { from: "markdown", to: "html" }, { limits });
void commands; void plugins; void result;

const filter = createLuaFilterCapability({ readFile: async () => new Uint8Array() });
const standalone = createStandalonePandocCommand({ limits });
const parsed = parseConversionArgs(["-f", "markdown", "-t", "plain"], {
  stdin: [], readFile: async () => new Uint8Array(),
}, new AbortController().signal);
void filter; void standalone; void parsed;
