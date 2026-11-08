import * as own from "../dist/index.js";
import * as original from "@poe-code/agent-harness-tools";
const forward:Omit<Pick<typeof original,keyof typeof own>,"resolvePoeCommandExecution">=own;
const reverse:Omit<typeof own,"resolveLoopAgent"|"resolvePoeCommandExecution">=original;
const forwardResolve:(...args:Parameters<typeof own.resolvePoeCommandExecution>)=>Promise<ReturnType<typeof own.resolvePoeCommandExecution>>=original.resolvePoeCommandExecution;
void [forward,reverse,forwardResolve];
