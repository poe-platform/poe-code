import {createPythonPackageEnvironment, type PythonPackageEnvironment, type PythonPackageOptions} from './provisioning.js';
import {createPythonPackageManifestStore} from './manifest.js';

/** Fresh build dependency state with the caller's explicit artifact and network authority. */
export function createPythonBuildEnvironment(options:PythonPackageOptions={}):PythonPackageEnvironment {
 const manifestStore=createPythonPackageManifestStore({maxEntries:1,...options.maxManifestBytes===undefined?{}:{maxBytes:options.maxManifestBytes}});
 const isolated={...options,manifestStore,scope:'build'};
 delete isolated.noDeps;
 delete isolated.constraints;
 delete isolated.constraintFiles;
 delete isolated.editable;
 delete isolated.requirements;
 delete isolated.requirementFiles;
 delete isolated.profile;
 const environment=createPythonPackageEnvironment(isolated);
 let disposing:Promise<void>|undefined;
 return {...environment,prepare(context){
  const {noDeps:ignoredNoDeps,constraints:ignoredConstraints,constraintFiles:ignoredFiles,...input}=context;
  return environment.prepare(input);
 },dispose(){
  return disposing??=environment.dispose().finally(()=>manifestStore.dispose());
 }};
}
