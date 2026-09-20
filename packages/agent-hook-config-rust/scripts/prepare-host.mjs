import {mkdirSync,copyFileSync,readdirSync}from'node:fs';
const root=new URL('../',import.meta.url),dist=new URL('dist/',root);
mkdirSync(dist,{recursive:true});for(const name of readdirSync(new URL('src/',root)))if(name.endsWith('.d.ts'))copyFileSync(new URL('src/'+name,root),new URL(name,dist));
copyFileSync(new URL('../config-mutations-rust/src/snapshot.js',root),new URL('snapshot.js',dist));
