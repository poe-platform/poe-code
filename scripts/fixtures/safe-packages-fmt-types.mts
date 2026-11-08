import { createFmtEngine, parseFmtArguments, fmtCommand, fmtCommands, fmt, FmtError, defaultFmtLimits, fmtBaseline,
  type FmtEngine, type FmtMachine, type FmtOptions, type FmtLimits, type FmtRunOptions, type FmtAccounting, type FmtResult }
  from '@poe-platform/safe-bash/commands/fmt';
import type { CommandContext, CommandDefinition } from '@poe-platform/safe-bash/contracts';
const limits: FmtLimits = defaultFmtLimits;
const options: FmtOptions = parseFmtArguments([new TextEncoder().encode('-w8')], { limits, profile: fmtBaseline.profile });
const engine: FmtEngine = createFmtEngine(options, limits, new AbortController().signal);
const machine: FmtMachine = engine.run();
const counters: FmtAccounting = engine.accounting();
const command: CommandDefinition = fmtCommand({ limits });
const runOptions: FmtRunOptions = { width: 8, goal: 7, crown: true, tagged: true, split: true,
  uniform: true, prefix: new Uint8Array(), files: ['/input'], limits };
async function sdk(context: CommandContext): Promise<FmtResult> { return fmt(context, runOptions); }
void fmtCommands({ replace: true, limits });
void machine; void counters; void command; void sdk; void new FmtError('LIMIT', 'limit');
engine.dispose();
