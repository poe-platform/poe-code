import * as terminal from './terminal-adapter-v2.mjs';
import * as mechanisms from './mechanism-adapter-v1.mjs';
export const candidate = mechanisms.candidate;
export const supportedIds = [...terminal.supportedIds, ...mechanisms.supportedIds];
export const observeTerminalState = terminal.observeTerminalState;
export const execute = mechanisms.execute;
