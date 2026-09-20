import {mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
const root=new URL('../',import.meta.url),dist=new URL('dist/',root),frontmatter=new URL('frontmatter/',dist),config=new URL('config/',frontmatter);
mkdirSync(config,{recursive:true});
copyFileSync(new URL('src/index.d.ts',root),new URL('index.d.ts',dist));
copyFileSync(new URL('../frontmatter-rust/src/index.js',root),new URL('index.js',frontmatter));
writeFileSync(new URL('native.js',frontmatter),"export {native} from '../native.js';\n");
for(const name of ['yaml-snapshot.js','snapshot.js'])copyFileSync(new URL('../config-mutations-rust/src/'+name,root),new URL(name,config));
