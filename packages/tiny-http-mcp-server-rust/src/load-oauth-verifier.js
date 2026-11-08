import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url)('./tiny-http-mcp-server-rust.node');
export async function loadOAuthVerifier({modulePath,exportName='default',cwd=process.cwd()}){
 const kind=native.httpVerifierModuleKind(modulePath);
 const specifier=kind==='path'?pathToFileURL(path.isAbsolute(modulePath)?modulePath:path.resolve(cwd,modulePath)).href:modulePath;
 const module=await import(specifier),value=module[exportName];
 if(value===null||typeof value!=='object'||!Object.hasOwn(value,'verify')||typeof value.verify!=='function')throw new Error(`OAuth verifier export "${exportName}" from "${modulePath}" must be an object with a verify() method.`);
 return value;
}
