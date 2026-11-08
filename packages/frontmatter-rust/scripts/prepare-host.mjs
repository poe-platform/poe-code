import {mkdirSync,copyFileSync} from 'node:fs';
const root=new URL('../',import.meta.url),dist=new URL('dist/',root),config=new URL('config/',dist);
mkdirSync(config,{recursive:true});
copyFileSync(new URL('src/index.d.ts',root),new URL('index.d.ts',dist));
for(const name of ['yaml-snapshot.js','snapshot.js'])copyFileSync(new URL('../config-mutations-rust/src/'+name,root),new URL(name,config));
