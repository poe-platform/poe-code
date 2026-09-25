import { createMdqCommand, createMdqCommands, mdq, mdqCommand, mdqCommands, parseMdqArguments, type MdqCommandOptions, type MdqCommandsOptions, type MdqLimits, type MdqOptions, type MdqResult, type MdqRunOptions } from "@poe-platform/safe-bash/commands/mdq";
import { createMdqCommand as rootCommand, createMdqCommands as rootCommands, mdq as rootMdq, mdqCommands as rootPlugin, type CommandContext, type CommandDefinition, type MdqCommandsOptions as RootMdqCommandsOptions, type VirtualShellPlugin } from "@poe-platform/safe-bash";

const limits: MdqLimits = { inputBytes: 10000, outputBytes: 20000, work: 100000 };
const commandOptions: MdqCommandOptions = { limits, replace: true };
const collectionOptions: MdqCommandsOptions = commandOptions;
const rootOptions: RootMdqCommandsOptions = collectionOptions;
const options: MdqOptions = {
  selectors: "# Authentication | # Token expiry", files: ["/SPEC.md"], output: "markdown",
  linkPos: "doc", footnotePos: "section", linkFormat: "inline", renumberFootnotes: false,
  wrapWidth: 80, quiet: false, breaks: true, allowUnknownMarkdown: false,
};
const invocation: MdqRunOptions = { ...options, limits };
const commands: CommandDefinition[] = [mdqCommand, createMdqCommand(commandOptions), rootCommand(commandOptions)];
const collections: readonly CommandDefinition[] = [...createMdqCommands(collectionOptions), ...rootCommands(rootOptions)];
const plugins: VirtualShellPlugin[] = [mdqCommands(commandOptions), rootPlugin(commandOptions)];
declare const context: CommandContext;
const result: MdqResult = await mdq(context, invocation);
const rootResult: MdqResult = await rootMdq(context, { argv: ["-o", "json", "# Authentication"] });
const work: number | undefined = result.accounting.work;
void commands; void collections; void plugins; void work; void rootResult; void parseMdqArguments(["# Authentication"]);
// @ts-expect-error File operands are readonly.
options.files?.push("/other.md");
// @ts-expect-error Output choices preserve the CLI's finite formats.
void mdq(context, { output: "html" });
// @ts-expect-error Quiet is a boolean in the typed SDK.
void mdq(context, { quiet: "true" });
