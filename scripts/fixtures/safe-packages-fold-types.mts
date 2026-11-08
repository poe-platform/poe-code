import { createFoldEngine, parseFoldArguments, FoldError, adjustFoldColumn, type FoldEngine, type FoldLocale, type FoldLimits, type FoldOptions, type FoldErrorCode, type FoldColumnState, type FoldGlyph } from '@poe-platform/safe-bash/commands/fold';
const limits: FoldLimits = { inputBytes: 100, outputBytes: 200, work: 10000, retainedBytes: 8196, argumentBytes: 1000 };
const options: FoldOptions = parseFoldArguments(['-c', '-w5'], limits);
const locale: FoldLocale = 'UTF-8/Unicode-17.0.0';
const engine: FoldEngine = createFoldEngine(options, locale, limits, new AbortController().signal);
const chunks: readonly Uint8Array[] = engine.push(Uint8Array.of(97));
const glyph: FoldGlyph = { codePoint: 97, byteLength: 1 };
const state: FoldColumnState = adjustFoldColumn({ column: 0, lastWidth: 0 }, glyph, options.mode, locale);
const code: FoldErrorCode = new FoldError('LIMIT', 'limit').code;
void chunks; void state; void code;
engine.endFile(); engine.dispose();
import { createFoldCommand, foldCommands, fold, type FoldCommandOptions, type FoldRunOptions, type FoldResult } from '@poe-platform/safe-bash/commands/fold';
import { type CommandContext, type CommandDefinition, type VirtualShellPlugin } from '@poe-platform/safe-bash/contracts';
const commandOptions: FoldCommandOptions = { locale, limits, replace: false };
const command: CommandDefinition = createFoldCommand(commandOptions);
const plugin: VirtualShellPlugin = foldCommands(commandOptions);
const runOptions: FoldRunOptions = { ...commandOptions, width: 5, mode: 'bytes', spaces: true, files: ['literal'] };
async function sdk(context: CommandContext): Promise<FoldResult> { return fold(context, runOptions); }
void command; void plugin; void sdk;
