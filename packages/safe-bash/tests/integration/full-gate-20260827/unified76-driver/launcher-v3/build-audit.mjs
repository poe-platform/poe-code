import {mkdirSync,realpathSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';

if(process.env.UNIFIED76_BUILD_AUDIT){
  const source=realpathSync(process.env.UNIFIED76_BUILD_SOURCE);
  const compiler=join(source,'node_modules/typescript/bin/tsc');
  if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(compiler)){
    const args=process.argv.slice(2);
    let project;
    for(let index=0;index<args.length;index++){
      if(args[index]==='-p'||args[index]==='--project')project=args[index+1];
      else if(args[index].startsWith('--project='))project=args[index].slice(10);
    }
    if(project&&resolve(process.cwd(),project)===join(source,'tsconfig.build.json')){
      const output=realpathSync(process.env.UNIFIED76_BUILD_AUDIT);
      mkdirSync(output,{recursive:true});
      writeFileSync(join(output,`${process.pid}-${randomUUID()}.json`),JSON.stringify({
        nonce:process.env.UNIFIED76_BUILD_NONCE,pid:process.pid,parent:process.ppid,
        executable:realpathSync(process.execPath),compiler,project:join(source,'tsconfig.build.json'),
        cwd:process.cwd(),args,startedAt:new Date().toISOString(),
      })+'\n',{flag:'wx'});
    }
  }
}
