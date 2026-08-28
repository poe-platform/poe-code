import type { CommandInvokeOptions, ShellInvokeOptions } from "../../../../src/index.js";

declare const signal: AbortSignal;

const commandOmitted: CommandInvokeOptions = {};
const commandUndefined: CommandInvokeOptions = { signal: undefined };
const commandSignal: CommandInvokeOptions = { signal };
const shellOmitted: ShellInvokeOptions = {};
const shellUndefined: ShellInvokeOptions = { signal: undefined };
const shellSignal: ShellInvokeOptions = { signal };

void [commandOmitted, commandUndefined, commandSignal, shellOmitted, shellUndefined, shellSignal];

// @ts-expect-error signal is readonly
commandSignal.signal = undefined;
// @ts-expect-error null is not an AbortSignal
const badCommandNull: CommandInvokeOptions = { signal: null };
// @ts-expect-error controllers are not signals
const badCommandController: CommandInvokeOptions = { signal: new AbortController() };
// @ts-expect-error signal is readonly
shellSignal.signal = undefined;
// @ts-expect-error a signal-shaped object is not an AbortSignal
const badShellShape: ShellInvokeOptions = { signal: { aborted: false } };

void [badCommandNull, badCommandController, badShellShape];
