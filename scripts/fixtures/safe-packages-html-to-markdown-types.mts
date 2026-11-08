import { createHtmlToMarkdownCommand, createHtmlToMarkdownCommands, htmlToMarkdownCommands, type HtmlToMarkdownCommandsOptions, type HtmlToMarkdownLimits } from "@poe-platform/safe-bash/commands/html-to-markdown";
import type { CommandDefinition } from "@poe-platform/safe-bash/contracts/command";
const limits: Partial<HtmlToMarkdownLimits> = { maxInputBytes: 1024, maxOutputBytes: 2048, maxNodes: 100 };
const options: HtmlToMarkdownCommandsOptions = { limits, replace: true };
const command: CommandDefinition = createHtmlToMarkdownCommand(options);
const commands: readonly CommandDefinition[] = createHtmlToMarkdownCommands(options);
void command;
void commands;
void htmlToMarkdownCommands(options);
