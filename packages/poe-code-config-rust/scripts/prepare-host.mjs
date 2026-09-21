import {execFileSync} from "node:child_process";
import {mkdirSync,copyFileSync,writeFileSync,readdirSync,readFileSync} from "node:fs";
const root=new URL("../",import.meta.url),dist=new URL("dist/",root),extendsRoot=new URL("extends/",dist);
mkdirSync(extendsRoot,{recursive:true});
for(const name of ["index.js","resolution.js","merge-snapshot.js"])
 copyFileSync(new URL("../config-extends-rust/src/"+name,root),new URL(name,extendsRoot));
writeFileSync(new URL("native.js",extendsRoot),"export {native} from '../addon.js';\n");
writeFileSync(new URL("addon.js",dist),"import {createRequire} from 'node:module';export const native=createRequire(import.meta.url)('./poe-code-config-rust.node');\n");
for(const name of ["index.d.ts"])copyFileSync(new URL("src/extends/"+name,root),new URL(name,extendsRoot));
const frontmatter=new URL("frontmatter/",extendsRoot),config=new URL("config/",frontmatter),design=new URL("design/",extendsRoot);
mkdirSync(config,{recursive:true});mkdirSync(design,{recursive:true});
copyFileSync(new URL("../frontmatter-rust/src/index.js",root),new URL("index.js",frontmatter));
writeFileSync(new URL("native.js",frontmatter),"export {native} from '../native.js';\n");
for(const name of ["yaml-snapshot.js","snapshot.js"])copyFileSync(new URL("../config-mutations-rust/src/"+name,root),new URL(name,config));
for(const name of ["engine.js","data.js"])copyFileSync(new URL("../toolcraft-design-rust/src/"+name,root),new URL(name,design));
copyFileSync(new URL("src/provider-types.d.ts",root),new URL("provider-types.d.ts",dist));

copyFileSync(new URL("../config-mutations-rust/src/snapshot.js",root),new URL("snapshot.js",dist));
copyFileSync(new URL("src/snapshot.d.ts",root),new URL("snapshot.d.ts",dist));

for(const packageName of ["providers-rust","agent-defs-rust"]){
 const ownedRoot=new URL("../"+packageName+"/",root);
 execFileSync(process.execPath,[new URL("scripts/prepare-host.mjs",ownedRoot).pathname],{stdio:"inherit"});
 const destination=new URL(packageName==="providers-rust"?"providers/":"agents/",dist);
 mkdirSync(destination,{recursive:true});
 for(const name of readdirSync(new URL("src/",ownedRoot)))if(name.endsWith(".js")||name.endsWith(".d.ts"))copyFileSync(new URL("src/"+name,ownedRoot),new URL(name,destination));
 for(const name of readdirSync(new URL("dist/",ownedRoot)))if(name.endsWith(".d.ts")||name==="agents.js")copyFileSync(new URL("dist/"+name,ownedRoot),new URL(name,destination));
 if(packageName==="providers-rust"){
  const wrappers=new URL("providers/",destination);mkdirSync(wrappers,{recursive:true});
  for(const name of readdirSync(new URL("dist/providers/",ownedRoot)))copyFileSync(new URL("dist/providers/"+name,ownedRoot),new URL(name,wrappers));
  writeFileSync(new URL("native.js",destination),"export {native} from '../addon.js';\n");
 }else{
  const runtime=new URL("agent-runtime.js",destination);
  const source=readFileSync(runtime,"utf8");
  writeFileSync(runtime,source.replace("const native=createRequire(import.meta.url)('./agent-defs-rust.node');","const native=createRequire(import.meta.url)('../poe-code-config-rust.node');"));
 }
}
