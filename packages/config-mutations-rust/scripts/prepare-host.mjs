import {mkdirSync,readdirSync,copyFileSync} from 'node:fs';
const root=new URL('../',import.meta.url),dist=new URL('dist/',root),source=new URL('src/',root);
mkdirSync(dist,{recursive:true});
for(const filename of readdirSync(source))if(filename.endsWith('.d.ts'))copyFileSync(new URL(filename,source),new URL(filename,dist));
const design=new URL('design/',dist),designSource=new URL('../toolcraft-design-rust/src/',root);
mkdirSync(design,{recursive:true});
for(const filename of ['engine.js','data.js'])copyFileSync(new URL(filename,designSource),new URL(filename,design));
