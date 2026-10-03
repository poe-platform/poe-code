import * as native from "../dist/safe-bash.js";
import * as reference from "toolcraft/safe-bash";
import {S,defineCommand,defineGroup} from "../dist/index.js";
import type {CommandContext,ShellCapabilities} from "@poe-platform/safe-bash";

const canonicalApi:typeof reference=native;
const nativeApi:typeof native=reference;
const command=defineCommand({name:"run",params:S.Object({count:S.Number()}),handler(ctx){
  const cwd:string|undefined=ctx.cwd;
  const stdin:CommandContext["stdin"]|undefined=ctx.stdin;
  const stdout:CommandContext["stdout"]|undefined=ctx.stdout;
  const stderr:CommandContext["stderr"]|undefined=ctx.stderr;
  const regex:ShellCapabilities["regex"]=ctx.regex;
  const cleanup:CommandContext["registerCleanup"]|undefined=ctx.registerCleanup;
  const invoke:CommandContext["invoke"]|undefined=ctx.invoke;
  const budget:CommandContext["inputBudget"]|undefined=ctx.inputBudget;
  void [cwd,stdin,stdout,stderr,regex,cleanup,invoke,budget];
  return ctx.params.count;
}});
const library=defineGroup({name:"tools",children:[command] as const});
native.toolcraftCommands(library,{defaults:native.toolcraftDefaults(library,{run:{count:0}})});
// @ts-expect-error inferred parameter values remain checked
native.toolcraftDefaults(library,{run:{count:"zero"}});
void [canonicalApi,nativeApi];
