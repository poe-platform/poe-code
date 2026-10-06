import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const source=new URL('../src/package-program.py',import.meta.url);
const output=new URL('../src/package-program.generated.ts',import.meta.url);
const encoded=gzipSync(await readFile(source),{level:9}).toString('base64');
const contents='// Generated from package-program.py. Run npm run build to regenerate.\nexport const pythonPackageProgramGzip = '+JSON.stringify(encoded)+';\n';
if(process.argv.includes('--check')){
 if(await readFile(output,'utf8')!==contents)throw new Error('Python package program is stale; run npm run build in safe-bash-command-python');
}else await writeFile(output,contents);
