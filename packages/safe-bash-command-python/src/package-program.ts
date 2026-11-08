import {pythonPackageProgramGzip} from './package-program.generated.js';
let decoded:Promise<string>|undefined;
/** Decode trusted static Python source once without adding interpreter frames. */
export function loadPythonPackageProgram():Promise<string>{
 return decoded??=new Response(new Blob([Uint8Array.from(atob(pythonPackageProgramGzip),character=>character.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
