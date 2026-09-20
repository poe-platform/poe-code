import {createHostRunner}from'./host-runner.js';import {native}from'./native.js';
function own(value,key){return value!==undefined&&Object.hasOwn(value,key)?value[key]:undefined;}
export const hostExecutionEnvFactory={type:'host',supportsDetach:false,supportsWorkspaceTransfer:false,
 async open(openSpec){return {id:'host',job:null,
  async uploadWorkspace(){return {files:0,bytes:0,skipped:[]};},
  async downloadWorkspace(){return {files:0,bytes:0,conflicts:[]};},
  exec(spec){return createHostRunner().exec(spec);},
  async detach(){throw new Error(native.HOST_DETACH_ERROR);},
  shell(){
   const shell=openSpec.shellSpec,args=own(shell,'args'),cwd=own(shell,'cwd'),env=own(shell,'env'),signal=own(shell,'signal');
   const errors=[];
   const read=key=>{try{let value;switch(key){case 'envShell':value=openSpec.env.SHELL;break;case 'systemShell':value=process.env.SHELL;break;case 'defaultCwd':value=openSpec.cwd;break;default:throw new Error(`Unknown native shell fact ${key}`);}return {value};}catch(error){return {error:errors.push(error)-1};}};
   const plan=native.hostShell({command:own(shell,'command'),cwd,hasArgs:!!args,hasSignal:signal!==undefined,ownEnv:shell!==undefined&&Object.hasOwn(shell,'env')},read);
   if(plan.error!==undefined)throw errors[plan.error];
   return createHostRunner().exec({command:plan.command,cwd:plan.cwd,env:plan.ownEnv?env:openSpec.env,stdin:'inherit',stdout:'inherit',stderr:'inherit',tty:true,...(plan.hasArgs?{args}:{}),...(plan.hasSignal?{signal}:{})});
  },
  async close(){}
 };},
 async attach(){throw new Error(native.HOST_ATTACH_ERROR);}
};
