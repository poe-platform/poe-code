import * as own from '../dist/index.js';
import * as reference from 'terminal-png-mcp';
const a: typeof reference = own;
const b: typeof own = reference;
import type {runCli as originalCli} from '../../terminal-png-mcp/src/cli.js';
import {runCli} from '../dist/cli.js';
const c: typeof originalCli = runCli;
const d: typeof runCli = null as unknown as typeof originalCli;
void [a,b,c,d];
