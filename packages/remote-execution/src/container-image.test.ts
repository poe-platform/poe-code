import {expect,it,vi} from 'vitest';
import {Volume,createFsFromVolume} from 'memfs';
import {prepareContainerImage} from './container-image.js';
it('requires the operator module before creating an image context',async()=>{
 const fs=createFsFromVolume(new Volume()).promises;
 const bundle=vi.fn();
 await expect(prepareContainerImage({root:'/repo',output:'/image',deployment:'/operator.mjs'},{fs:fs as never,bundle})).rejects.toThrow();
 expect(bundle).not.toHaveBeenCalled();expect(await fs.readdir('/').catch(()=>[])).toEqual([]);
});
it('packages server protocol, pinned assets and explicit operator configuration',async()=>{
 const volume=Volume.fromJSON({
  '/operator.mjs':'export default configuration;',
  '/repo/packages/remote-execution/cloudflare/bootstrap.mjs':'bootstrap',
  '/repo/packages/media-cli/server/download.mjs':'download',
  '/repo/packages/media-cli/server/container-lock.json':'{"version":1}',
  '/repo/packages/remote-execution/native/execve.c':'native execve source',
 });
 const fs=createFsFromVolume(volume).promises;
 const bundle=vi.fn(async(_entry:string,output:string)=>{await fs.writeFile(output,'bundled');});
 await prepareContainerImage({root:'/repo',output:'/image',deployment:'/operator.mjs'},{fs:fs as never,bundle});
 expect(bundle.mock.calls).toEqual([
  ['/repo/packages/media-cli/src/server.ts','/image/media-server.mjs'],
  ['/repo/packages/remote-execution/src/http-server.ts','/image/http-server.mjs'],
  ['/repo/packages/remote-execution/src/container-lifecycle.ts','/image/container-lifecycle.mjs'],
  ['/operator.mjs','/image/deployment.mjs'],
 ]);
 expect(await fs.readFile('/image/bootstrap.mjs','utf8')).toBe('bootstrap');
 expect(await fs.readFile('/image/container-lock.json','utf8')).toBe('{"version":1}');
 expect(await fs.readFile('/image/execve.c','utf8')).toBe('native execve source');
});
it('refuses to overwrite an existing image context',async()=>{
 const fs=createFsFromVolume(Volume.fromJSON({'/operator.mjs':'config','/image/existing':'owned'})).promises;
 const bundle=vi.fn();
 await expect(prepareContainerImage({root:'/repo',output:'/image',deployment:'/operator.mjs'},{fs:fs as never,bundle})).rejects.toThrow();
 expect(await fs.readFile('/image/existing','utf8')).toBe('owned');expect(bundle).not.toHaveBeenCalled();
});
