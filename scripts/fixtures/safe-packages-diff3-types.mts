import { analyzeDiff3, createDiff3Engine, Diff3Error, type Diff3Engine, type Diff3Analysis, type Diff3Limits, type Diff3Options, type Diff3File, type Diff3Accounting, type Diff3Line, type Diff3Range, type Diff3Edit, type Diff3Region, type Diff3ErrorCode } from '@poe-platform/safe-bash/commands/diff3';
const limits: Diff3Limits = { inputBytes: 1000, retainedBytes: 2000, tokens: 100, graphCells: 10000, work: 10000 };
const options: Diff3Options = { stripTrailingCR: true, text: true };
const engine: Diff3Engine = createDiff3Engine(limits, options, new AbortController().signal);
const file: Diff3File = 'base';
engine.push(file, Uint8Array.of(255, 10));
const accounting: Diff3Accounting = engine.accounting();
engine.dispose();
const result: Diff3Analysis = analyzeDiff3({ base: new Uint8Array(), left: new Uint8Array(), right: new Uint8Array() }, limits);
const lines: readonly Diff3Line[] = result.files.base;
const edits: readonly Diff3Edit[] = result.leftEdits;
const regions: readonly Diff3Region[] = result.regions;
const range: Diff3Range = { start: 0, end: 0 };
const code: Diff3ErrorCode = new Diff3Error('LIMIT', 'quota', 'tokens').code;
void accounting; void lines; void edits; void regions; void range; void code;

import { compareDiff3, parseDiff3Arguments, diff3, createDiff3Command, diff3Commands, diff3DefaultLimits, type Diff3BehaviorLimits, type Diff3Invocation, type Diff3BehaviorResult, type Diff3CommandResult, type Diff3RunOptions } from '@poe-platform/safe-bash/commands/diff3';
import type { CommandContext } from '@poe-platform/safe-bash/contracts/command';
const behaviorLimits: Diff3BehaviorLimits = diff3DefaultLimits;
const invocation: Diff3Invocation = parseDiff3Arguments(['-mE', 'ours', 'base', 'theirs'], behaviorLimits);
const behavior: Diff3BehaviorResult = compareDiff3([new Uint8Array(), new Uint8Array(), new Uint8Array()], invocation, behaviorLimits);
const runOptions: Diff3RunOptions = { files: ['ours', 'base', 'theirs'], selector: 'E', merge: true, limits: { outputBytes: 100 } };
function run(context: CommandContext): Promise<Diff3CommandResult> { return diff3(context, runOptions); }
createDiff3Command({ limits: { inputBytes: 100 } }); diff3Commands({ replace: true });
void behavior; void run;
