import {FsError} from 'safe-bash-contracts';
import {resolvePath,dirname,basename} from 'safe-bash-contracts/path';
import type {PythonPackageEnvironment} from './provisioning.js';

/** Carry installation provenance with durable source-wheel references across environment restores. */
export function withPythonSourceOrigins(environment:PythonPackageEnvironment,directory:string,maxBytes:number):PythonPackageEnvironment {
 const origins=new Map<string,{key:string;origin:string}>(),encoder=new TextEncoder();
 return {...environment,
  async dispatch(operation,args,context){
   const result=await environment.dispatch(operation,args,context),session=String(args[0]);
   if(operation==='package-open'){
    origins.delete(session);
    const url=new URL(String(args[1]));
    if(url.protocol==='file:'&&url.hash.startsWith('#python-source=')){
     const parent=dirname(decodeURIComponent(url.pathname));
     if(basename(parent)!==(result as {key:string}).key)return result;
     let root:string;
     try{root=await context.fs.realpath(resolvePath(context.cwd,directory),{signal:context.signal});}
     catch(error){if(error instanceof FsError&&error.code==='ENOENT')return result;throw error;}
     if(dirname(parent)!==root)return result;
     const origin=decodeURIComponent(url.hash.slice('#python-source='.length));
     if(encoder.encode(origin).length>maxBytes)throw new RangeError('Python source origin exceeds maxMetadataBytes');
     origins.set(session,{key:(result as {key:string}).key,origin});
    }
   }else if(operation==='package-retain'){
    const origin=origins.get(session);origins.delete(session);
    if(origin!==undefined)return {...result as object,metadata:{'direct_url.json':origin.origin}};
   }else if(operation==='package-close'&&origins.get(session)?.key===String(args[1]))origins.delete(session);
   return result;
  },
  finish(start){origins.delete(start.session);return environment.finish(start);},
  async dispose(){try{await environment.dispose();}finally{origins.clear();}},
 };
}
