import fs from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import {hash,readPinned} from './auth.mjs';
import {PROFILE,validateRole,validateArguments} from './profile.mjs';
const roleName = process.env.SURFACE_ROLE;
const roleSize = Number(process.env.SURFACE_ROLE_BYTES);
const raw = readPinned(roleName,{bytes:roleSize,sha256:process.env.SURFACE_ROLE_SHA256},2097152);
const role = validateRole(JSON.parse(raw));
if (roleName !== role.rolePath || process.execPath !== role.nodePath) throw Error('CHILD_IDENTITY');
validateArguments(role,[...process.execArgv,process.argv[1]],process.env);
if (!process.permission || ['child','worker','addon','wasi','inspector'].some(scope => process.permission.has(scope))) throw Error('PERMISSION_NOT_DENIED');
let traceBytes = 0;
function trace(event) {
  const bytes = Buffer.from(JSON.stringify({...event,profile:PROFILE,role:role.id}) + '\n');
  traceBytes += bytes.length;
  if (traceBytes > 524288) throw Error('TRACE_LIMIT');
  fs.appendFileSync(role.trace,bytes);
}
trace({event:'permission-admitted',child:false,worker:false,loaderThreads:0});
registerHooks({
  resolve(specifier,context,nextResolve) {
    if (context.parentURL?.startsWith('file:')) {
      const parent = fileURLToPath(context.parentURL);
      if (!role.edges[parent]?.includes(specifier)) throw Error('EDGE_REFUSED');
    }
    if (specifier.startsWith('node:')) {
      if (!role.builtins.includes(specifier)) throw Error('BUILTIN_REFUSED');
      return nextResolve(specifier,context);
    }
    const resolved = nextResolve(specifier,context);
    if (!resolved.url.startsWith('file:') || !Object.hasOwn(role.files,fileURLToPath(resolved.url))) throw Error('LOAD_BINDING_REFUSED');
    return resolved;
  },
  load(url,context,nextLoad) {
    if (url.startsWith('node:')) return nextLoad(url,context);
    const filename = fileURLToPath(url), pin = role.files[filename];
    if (!pin) throw Error('LOAD_BINDING_REFUSED');
    const bytes = readPinned(filename,pin);
    trace({event:'module-loaded',url,bytes:bytes.length,sha256:hash(bytes)});
    return {format:'module',source:bytes,shortCircuit:true};
  }
});
trace({event:'synchronous-hooks-installed',loaderThreads:0});
