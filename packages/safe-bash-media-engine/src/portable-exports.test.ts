import {build} from 'esbuild';
import {expect, it} from 'vitest';

it('constructs the explicit remote adapter without Node, a shell runtime or native launch code',async()=>{
 const result=await build({
  absWorkingDir:new URL('..',import.meta.url).pathname,
  stdin:{resolveDir:new URL('..',import.meta.url).pathname,contents:`
   import {createRemoteMediaCommands} from '../safe-bash/src/commands/media/index.ts';
   export let requests=0;
   export const commands=createRemoteMediaCommands({
    service:'https://media.test',authToken:'explicit',buildDigest:'${'a'.repeat(64)}',
    resource:{namespaceId:'work',logicalRoot:'/',rights:['read'],grantId:'g',profile:'live'},
    async fetch(){requests++;throw new Error('Construction must be inert');}
   });
  `},
  platform:'browser',conditions:['workerd'],bundle:true,format:'esm',write:false,metafile:true,logLevel:'silent',
 });
 expect(Object.keys(result.metafile!.inputs).filter(path=>path.includes('/shell/')||path.includes('native-process')||path.includes('media-server'))).toEqual([]);
 const frontend=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
 expect(frontend.requests).toBe(0);expect(frontend.commands.name).toBe('media-commands');
 await frontend.commands.dispose();expect(frontend.requests).toBe(0);
});
