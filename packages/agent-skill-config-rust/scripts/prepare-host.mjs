import {mkdirSync,copyFileSync,readdirSync} from 'node:fs';
const root=new URL('../',import.meta.url),dist=new URL('dist/',root);mkdirSync(dist,{recursive:true});for(const name of readdirSync(new URL('src/',root)))if(name.endsWith('.d.ts'))copyFileSync(new URL('src/'+name,root),new URL(name,dist));
const mutations=new URL('mutations/',dist),mutationSource=new URL('../config-mutations-rust/src/',root);
mkdirSync(mutations,{recursive:true});
for(const name of readdirSync(mutationSource))if((name.endsWith('.js')||name.endsWith('.d.ts'))&&name!=='native.js')copyFileSync(new URL(name,mutationSource),new URL(name,mutations));
copyFileSync(new URL('src/mutations/native.js',root),new URL('native.js',mutations));
const design=new URL('design/',mutations);mkdirSync(design,{recursive:true});
for(const name of ['engine.js','data.js'])copyFileSync(new URL('../toolcraft-design-rust/src/'+name,root),new URL(name,design));
const templates=new URL('templates/',dist);mkdirSync(templates,{recursive:true});for(const name of readdirSync(new URL('src/templates/',root)))copyFileSync(new URL('src/templates/'+name,root),new URL(name,templates));
