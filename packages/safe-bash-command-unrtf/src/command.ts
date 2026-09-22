import { commandRuntimeIdentity, getCommandArguments, type CommandContext, type CommandDefinition } from 'safe-bash-contracts/command';
import { FsError } from 'safe-bash-contracts/errors';
import { readBytes, writeBytes } from 'safe-bash-contracts/io';
import { createOutputOperation, type OutputOperation } from 'safe-bash-contracts/output';
import type { VirtualShellPlugin } from 'safe-bash-contracts/plugin';
import { Budget, UnrtfError, type UnrtfLimits, type UnrtfOptions } from './contracts.js';
import { renderRtf } from './render.js';

export interface UnrtfCommandOptions {
  format?:'text'|'html'; file?:string; limits?:Partial<UnrtfLimits>;
  profile?:UnrtfOptions['profile']; replace?:boolean;
}
export interface UnrtfResult { readonly exitCode:0|1 }
const defaultLimits:UnrtfLimits = Object.freeze({inputBytes:16777216,retainedBytes:1048576,binaryBytes:16777216,images:1000,imageBytes:16777216,tokenBytes:8192,tokens:16777216,depth:256,decodedBytes:33554432,outputBytes:67108864,work:268435456});

async function executeUnrtf(context:CommandContext, configuration:UnrtfCommandOptions = {}, cli = false):Promise<UnrtfResult> {
  const controller = new AbortController(), signal = controller.signal;
  const abort = ():void => controller.abort(context.signal.reason);
  const limits = {...defaultLimits,...configuration.limits};
  let format = configuration.format ?? 'html', file = configuration.file;
  const profile = configuration.profile;
  let failed = false;
  const scope = {signal,...(context.registerCleanup ? {registerCleanup:context.registerCleanup.bind(context)} : {})};
  let stdout:OutputOperation | undefined, stderr:OutputOperation | undefined;
  let pending:Promise<void> = Promise.resolve(), closing:Promise<void> | undefined;
  const cleanup = ():Promise<void> => {
    if (closing) return closing;
    closing = Promise.resolve().then(async () => {
      controller.abort(new UnrtfError('E_CANCELLED','RTF invocation closed',0));
      await Promise.allSettled([pending]);
      context.signal.removeEventListener('abort',abort);
      const results = await Promise.allSettled([stdout?.close(),stderr?.close()]);
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors,'RTF invocation cleanup failed');
    });
    return closing;
  };
  context.registerCleanup?.(cleanup);
  pending = Promise.resolve().then(async () => {
    context.signal.addEventListener('abort',abort,{once:true});
    if (context.signal.aborted) abort();
    signal.throwIfAborted();
    stdout = createOutputOperation(scope,context.stdout);
    stderr = createOutputOperation(scope,context.stderr);
    const budget = new Budget({limits,signal,...(profile === undefined ? {} : {profile})});
    const admit = (value:string):void => {
      budget.bound('tokenBytes',value.length,0);
      budget.charge('work',value.length,0);
      const bytes = new TextEncoder().encode(value).length;
      budget.bound('tokenBytes',bytes,0); budget.charge('retainedBytes',bytes + value.length * 2,0);
    };
    if (cli) {
      const carrier = getCommandArguments(context);
      budget.bound('tokens',carrier.args.length,0);
      file = undefined;
      let operands = false;
      for (let i = 0; i < carrier.args.length; i++) {
        const projected = carrier.args[i]!; admit(projected);
        const bytes = carrier.bytes(i)!;
        budget.charge('work',bytes.length,0); budget.bound('tokenBytes',bytes.length,0);
        let arg:string;
        try { arg = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes); }
        catch { throw new UnrtfError('E_ENCODING','Arguments must be UTF-8',0); }
        if (!operands && arg === '--') { operands = true; continue; }
        if (operands) { if (file !== undefined) throw new UnrtfError('E_PARSE','Only one input file is supported',0); file = arg; }
        else if (arg === '--text') format = 'text';
        else if (arg === '--html') format = 'html';
        else if (arg === '--quiet' || arg === '--nopict' || arg === '-n') { /* Strict output has no comments or exports. */ }
        else if (arg.startsWith('--') && arg !== '--' || arg.startsWith('-') && arg !== '-' && arg !== '--') throw new UnrtfError('E_PROFILE','Option requires an unadmitted personality/configuration profile',0);
        else { if (file !== undefined) throw new UnrtfError('E_PARSE','Only one input file is supported',0); file = arg; }
      }
    } else if (file !== undefined) admit(file);
    if (format !== 'text' && format !== 'html') throw new UnrtfError('E_PROFILE','Only text and html formats are admitted',0);
    if (file?.includes('\0')) throw new UnrtfError('E_PARSE','NUL is unavailable in VFS paths',0);
    async function* source():AsyncGenerator<Uint8Array> {
      if (file === undefined) { yield* readBytes(context.stdin,signal); return; }
      const path = file.startsWith('/') ? file : context.cwd + '/' + file;
      for (const candidate of [path,path + '.rtf']) {
        let yielded = false;
        try {
          if (context.fs.readStream) {
            for await (const bytes of readBytes(context.fs.readStream(candidate,{signal}),signal)) { yielded = true; yield bytes; }
          } else {
            const bytes = await context.fs.readFile(candidate,{signal,maxBytes:Math.min(limits.inputBytes,limits.retainedBytes)});
            budget.charge('retainedBytes',bytes.length,0);
            try { yield bytes; } finally { budget.release('retainedBytes',bytes.length); }
          }
          return;
        } catch (error) {
          if (yielded || candidate !== path || !(error instanceof FsError) || error.code !== 'ENOENT') throw error;
        }
      }
    }
    for await (const bytes of renderRtf(source(),{format,limits,signal,...(profile === undefined ? {} : {profile})},budget))
      await writeBytes(stdout.output,bytes,stdout.signal);
  });
  try { await pending; return {exitCode:0}; }
  catch (error) {
    failed = true;
    if (signal.aborted) throw error;
    if (!(error instanceof UnrtfError) && !(error instanceof FsError)) throw error;
    const message = new TextEncoder().encode('unrtf: ' + error.code + ': ' + error.message + '\n');
    // Diagnostics are separately bounded, so exhaustion can still be reported.
    if (message.length > limits.tokenBytes + 1024) throw error;
    if (!stderr) throw error;
    await writeBytes(stderr.output,message,stderr.signal);
    return {exitCode:1};
  } finally {
    await cleanup().catch((error:unknown) => { if (!failed) throw error; });
  }
}
/** Stream stdin or one literal VFS file through the strict UTF-8 profile. */
export const unrtf:(context:CommandContext, options?:UnrtfCommandOptions) => Promise<UnrtfResult> = executeUnrtf;
export function createUnrtfCommand(options:UnrtfCommandOptions = {}):CommandDefinition {
  const configuration = Object.freeze({...options,limits:Object.freeze({...options.limits})});
  return Object.freeze({name:'unrtf',runtimeIdentity:commandRuntimeIdentity,description:'Project bounded RTF byte streams using the strict UTF-8 profile',execute(context:CommandContext) { return executeUnrtf(context,configuration,true); }});
}
export const unrtfCommand = createUnrtfCommand();
export function unrtfCommands(options:UnrtfCommandOptions = {}):VirtualShellPlugin {
  const command = createUnrtfCommand(options), replace = options.replace ?? false;
  return {name:'unrtf',setup(host) { host.commands.register(command,{replace}); }};
}
