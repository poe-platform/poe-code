import {PythonInstallationRoot} from './installation-root.js';
import {createPythonPackageFileManifestStore} from './manifest-file.js';
import type {PythonPackageManifestStore} from './manifest.js';
import type {PythonPackageContext} from './provisioning.js';

/** Environment-private caller storage is allocated only on first publication. */
export function createDefaultPythonManifestStore(context:PythonPackageContext,maxCacheBytes:number|undefined):PythonPackageManifestStore&{close():Promise<void>}{
 let root=new PythonInstallationRoot(context);
 let store:Promise<ReturnType<typeof createPythonPackageFileManifestStore>>|undefined;
 const writable=()=>store??=root.path().then(directory=>createPythonPackageFileManifestStore({fs:context.fs,directory,...maxCacheBytes===undefined?{}:{maxCacheBytes}})).catch(async error=>{await root.close();root=new PythonInstallationRoot(context);store=undefined;throw error;});
 return {
  async get(scope,options){return store?(await store).get(scope,options):undefined;},
  async openSnapshot(scope,options){return store?(await store).openSnapshot(scope,options):undefined;},
  async getSnapshot(scope,options){return store?(await store).getSnapshot(scope,options):undefined;},
  async compareAndSet(scope,revision,bytes,options){return (await writable()).compareAndSet(scope,revision,bytes,options);},
  async compareAndSetSnapshot(scope,revision,snapshot,options){return (await writable()).compareAndSetSnapshot!(scope,revision,snapshot,options);},
  close(){return root.close();},
 };
}
