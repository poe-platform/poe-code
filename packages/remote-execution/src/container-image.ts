/** Local packaging only: no SDK calls, registry pushes or provisioning. */
import type * as filesystem from 'node:fs/promises';
import {join} from 'node:path';
export async function prepareContainerImage(
 options:{root:string;output:string;deployment:string},
 dependencies:{fs:Pick<typeof filesystem,'access'|'mkdir'|'copyFile'>;bundle(entry:string,output:string):Promise<void>},
):Promise<void>{
 const {fs,bundle}=dependencies;
 await fs.access(options.deployment);
 const assets=[
  ['packages/remote-execution/cloudflare/bootstrap.mjs','bootstrap.mjs'],
  ['packages/media-cli/server/download.mjs','download.mjs'],
  ['packages/media-cli/server/container-lock.json','container-lock.json'],
  ['packages/remote-execution/native/execve.c','execve.c'],
 ] as const;
 for(const [source] of assets)await fs.access(join(options.root,source));
 // Exclusive creation keeps unrelated files and earlier contexts intact.
 await fs.mkdir(options.output);
 for(const [source,target] of assets)await fs.copyFile(join(options.root,source),join(options.output,target));
 await bundle(join(options.root,'packages/media-cli/src/server.ts'),join(options.output,'media-server.mjs'));
 await bundle(join(options.root,'packages/remote-execution/src/http-server.ts'),join(options.output,'http-server.mjs'));
 await bundle(join(options.root,'packages/remote-execution/src/container-lifecycle.ts'),join(options.output,'container-lifecycle.mjs'));
 await bundle(options.deployment,join(options.output,'deployment.mjs'));
}
