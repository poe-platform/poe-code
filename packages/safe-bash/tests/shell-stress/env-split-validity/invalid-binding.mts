import type { CommandInvokeOptions } from 'virtual-bash/contracts';
const invalid: CommandInvokeOptions = { stdin: new Uint8Array(), stdinIsDefault: false };
void invalid;
