import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const [directory,fixture]=process.argv.slice(2),files={};
for(const name of ['types','errors','limits','syntax','matcher']){
 const path=`${directory}/${name}.js`,stat=await lstat(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576)throw new Error('module admission');
 files[name]={path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};
}
console.log(JSON.stringify({event:'loaded',execPath:process.execPath,version:process.version,files}));
await import(pathToFileURL(fixture).href);
