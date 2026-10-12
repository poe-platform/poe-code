import {PythonInstallationRoot} from './installation-root.js';
import {createPythonPackageFileManifestStore} from './manifest-file.js';
import type {PythonPackageManifestStore} from './manifest.js';
import type {PythonPackageContext} from './provisioning.js';

/** Environment-private storage persists; filesystem admission belongs to each invocation. */
export function createDefaultPythonManifestStore(maxCacheBytes:number|undefined){
 let root:PythonInstallationRoot|undefined;
 return {
  forContext(context:PythonPackageContext):PythonPackageManifestStore{
   let store:Promise<ReturnType<typeof createPythonPackageFileManifestStore>>|undefined;
   const writable=()=>store??=(async()=>{
    const owned=root??=new PythonInstallationRoot(context);
    let directory:string;
    try{directory=await owned.path();}
    catch(error){await owned.close();if(root===owned)root=undefined;throw error;}
    await owned.path(context);
    return createPythonPackageFileManifestStore({fs:context.fs,directory,...maxCacheBytes===undefined?{}:{maxCacheBytes}});
   })();
   return {
    async get(scope,options){return root?(await writable()).get(scope,options):undefined;},
    async openSnapshot(scope,options){return root?(await writable()).openSnapshot(scope,options):undefined;},
    async getSnapshot(scope,options){return root?(await writable()).getSnapshot(scope,options):undefined;},
    async compareAndSet(scope,revision,bytes,options){return (await writable()).compareAndSet(scope,revision,bytes,options);},
    async compareAndSetSource(scope,revision,source,options){return (await writable()).compareAndSetSource!(scope,revision,source,options);},
    async compareAndSetSnapshot(scope,revision,snapshot,options){return (await writable()).compareAndSetSnapshot!(scope,revision,snapshot,options);},
   };
  },
  async close(){await root?.close();},
 };
}
