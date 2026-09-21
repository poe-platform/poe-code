import type * as Native from '../dist/index.js';
import type * as SDK from '../../terminal-png/dist/index.js';
declare const native:typeof Native;
declare const sdk:typeof SDK;
const sdkShape:typeof SDK=native;
const nativeShape:typeof Native=sdk;
void [sdkShape,nativeShape];

import type * as CLI from '../dist/cli.js';
import type * as SDKCLI from '../../terminal-png/dist/cli.js';
declare const cli:typeof CLI;
declare const sdkCli:typeof SDKCLI;
const cliSdk:typeof SDKCLI=cli;
const cliNative:typeof CLI=sdkCli;
void [cliSdk,cliNative];
