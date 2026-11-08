import {spawn}from'node:child_process';
import {fileURLToPath}from'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
async function run(args,capture=false){
 const child=spawn('docker',args,{cwd:root,stdio:capture?['ignore','pipe','inherit']:'inherit',shell:false});let output='';
 const completion=new Promise((resolve,reject)=>{child.once('error',error=>reject(new Error('Explicit Docker integration is unavailable; no host-process fallback was attempted',{cause:error})));child.once('close',code=>code===0?resolve():reject(new Error('Disposable container integration failed: '+code)));});
 const collect=(async()=>{if(capture)for await(const chunk of child.stdout){output+=chunk;if(output.length>1048576)throw new Error('Container identity output exceeded bound');}})();
 await Promise.all([completion,collect]);return output;
}
const tag='poe-remote-execution-integration:'+Date.now();let built=false;
try{
 await run(['version','--format','{{.Server.Version}}']);
 await run(['build','--force-rm','--platform','linux/amd64','-f','packages/remote-execution/integration/Dockerfile','-t',tag,'.']);built=true;
 const identity=(await run(['image','inspect','--format','{{.Id}}',tag],true)).trim();
 const isolation=['run','--rm','--init','--platform','linux/amd64','--read-only','--network','none','--pids-limit','64','--memory','512m','--cpus','2','--tmpfs','/scratch:rw,nosuid,nodev,size=64m,mode=1777','--cap-drop','ALL','--security-opt','no-new-privileges','-e','REMOTE_MEDIA_IMAGE_DIGEST='+identity];
 await run([...isolation,tag]);
}finally{if(built)await run(['image','rm',tag]);}
