import {pythonRuntimeProgramsGzip} from './runtime-programs.generated.js';
import type * as programs from './runtime-scripts.js';
let decoded:Promise<typeof programs>|undefined;
/** Decode the fixed bootstrap once; no guest or caller files enter this cache. */
export function loadPythonRuntimePrograms():Promise<typeof programs>{
 return decoded??=new Response(new Blob([Uint8Array.from(atob(pythonRuntimeProgramsGzip),character=>character.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
}
