import * as fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {prepareContainerImage} from '../dist/container-image.js';
const [deployment,output]=process.argv.slice(2);
if(!deployment||!output)throw new Error('Usage: node prepare-image.mjs <operator-module> <new-image-directory>');
const root=fileURLToPath(new URL('../../../',import.meta.url));
await prepareContainerImage({root,deployment:resolve(deployment),output:resolve(output)},{fs,async bundle(entry,outfile){
 await build({entryPoints:[entry],outfile,bundle:true,platform:'node',format:'esm',target:'node24',
  alias:{'@poe-code/remote-execution/server':resolve(root,'packages/remote-execution/src/server.ts'),'@poe-code/remote-execution/wire':resolve(root,'packages/remote-execution/src/wire.generated.ts')},
 });
}});
