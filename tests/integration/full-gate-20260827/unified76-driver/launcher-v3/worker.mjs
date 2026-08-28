import {parseArgs} from './policy.mjs';

if(import.meta.main){
  try{
    const supplied=JSON.parse(process.argv[2]);
    const options=parseArgs(['--candidate',supplied.candidate,'--run',supplied.output,'--release',supplied.release,'--committed-archive']);
    const{openFencedWorker}=await import('./fenced-supervisor.mjs');const scope=openFencedWorker();
    const{execute}=await import('./execute.mjs');process.exitCode=await execute(options,scope);
  }catch(error){console.error(error.stack);process.exitCode=error.exitCode??78;}
}
