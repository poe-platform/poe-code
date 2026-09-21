import {mkdirSync,copyFileSync,writeFileSync} from "node:fs";
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
