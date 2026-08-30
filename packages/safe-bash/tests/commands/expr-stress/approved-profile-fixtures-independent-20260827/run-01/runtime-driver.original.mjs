import assert from 'node:assert/strict';
import threads from 'node:worker_threads';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function run(payload) {
  const base=pathToFileURL(`${realpathSync(payload.installed)}/`).href;
  const imports=[],active=new Set(),events=[];
  const hooks=registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(context.parentURL?.startsWith(base)){assert(result.url.startsWith(base)||result.url.startsWith('node:'));imports.push({parent:context.parentURL,resolved:result.url});}return result;}});
  const NativeWorker=threads.Worker;
  threads.Worker=class extends NativeWorker {constructor(url,options){assert(url.href.startsWith(base));super(url,options);active.add(this);events.push('workerStart');this.on('exit',()=>active.delete(this));}};
  syncBuiltinESMExports();
  const output=[],errors=[],cleanups=[];
  let shell, result, caught, rejected=false;
  const reason=payload.input.reason==='Error'?new Error('independent diagnostic abort'):payload.input.reason;
  const controller=new AbortController();
  if(payload.input.preabort)controller.abort(reason);
  try {
    const api=await import(`${base}dist/index.js`);
    const {createExprCommand}=await import(`${base}dist/commands/expr/index.js`);
    const command=createExprCommand({limits:payload.input.limits});
    if(payload.input.id==='literal-command-binding') {
      shell=new api.Shell({fs:new api.MemoryFileSystem(),commands:new api.CommandRegistry([{...command,name:'expr-review-literal'}]),env:{LC_ALL:'C'}});
      const response=await shell.exec('expr-review-literal 1 x');
      result={exitCode:response.exitCode};output.push(Buffer.from(response.stdout));errors.push(Buffer.from(response.stderr));
    } else {
      result=await command.execute({command:payload.input.name??'expr',args:payload.input.argv,cwd:'/',env:{LC_ALL:'C'},signal:controller.signal,
        stdinIsDefault:true,get stdin(){throw new Error('unexpected stdin access');},fs:new Proxy({},{get(){throw new Error('unexpected filesystem access');}}),invoke(){throw new Error('unexpected invocation');},
        stdout:{async write(bytes){assert(Buffer.concat(output).length+bytes.length<=8192);output.push(Buffer.from(bytes));}},
        stderr:{async write(bytes){assert(Buffer.concat(errors).length+bytes.length<=8192);errors.push(Buffer.from(bytes));}},
        registerCleanup(cleanup){events.push('registerCleanup');cleanups.push(cleanup);}
      });
    }
  } catch(error) {rejected=true;caught=error;}
  const activeAtSettlement=active.size;
  for(const cleanup of cleanups)await cleanup();
  if(shell)await shell.dispose();
  await new Promise(resolve=>setImmediate(resolve));
  const activeBeforeSafetyCleanup=active.size;
  for(const worker of active)await worker.terminate();
  threads.Worker=NativeWorker;syncBuiltinESMExports();hooks.deregister();
  return {status:result?.exitCode??null,stdoutBase64:Buffer.concat(output).toString('base64'),stderrBase64:Buffer.concat(errors).toString('base64'),rejected,error:rejected?{name:caught?.name,message:caught?.message}:null,exactReasonIdentity:rejected&&caught===reason,events,imports,activeAtSettlement,activeBeforeSafetyCleanup,activeAfterSafetyCleanup:active.size};
}
