import type {PythonPackageInstallOptions} from './provisioning.js';
import { PythonInvocationError } from './invocation.js';

/** An expected package failure whose diagnostic is safe to show to the caller. */
export class PythonInstallationError extends Error {}

export interface PythonInstallation {
  readonly controls: PythonPackageInstallOptions;
  readonly packages: readonly string[];
  readonly requirements: readonly string[];
  readonly help: boolean;
  readonly uninstall?: boolean;
  readonly yes?: boolean;
}

export const pythonInstallationHelp = `Usage: python -m pip install [OPTIONS] PACKAGE ...
       python -m pip uninstall [-y/--yes] PACKAGE ...
Install: -r/--requirement FILE, -c/--constraint FILE, -e/--editable PATH,
         --pre, --no-deps/--no-dependencies, -U/--upgrade,
         --force-reinstall, --no-cache-dir, --no-index
         -i/--index-url URL, --extra-index-url URL
Both accept -h/--help and --.
`;

/** Parse arguments after the validated Python pip module entrypoint. */
export function parsePythonInstallation(pipArgs: readonly string[]): PythonInstallation {
  const controls: { -readonly [K in keyof PythonPackageInstallOptions]: PythonPackageInstallOptions[K] } = {};
  const packages: string[] = [];
  const requirements: string[] = [];
  if (pipArgs.length === 0 || pipArgs[0] === '--help' || pipArgs[0] === '-h') {
    if (pipArgs.length > 1) throw new PythonInvocationError('unsupported pip option or argument after help: ' + pipArgs[1]);
    return { packages, requirements, controls, help: true };
  }
  const uninstall = pipArgs[0] === 'uninstall';
  let yes = false;
  if (!uninstall && pipArgs[0] !== 'install') throw new PythonInvocationError('unsupported pip command ' + pipArgs[0]);
  let operands = false;
  let help = false;
  for (let index = 1; index < pipArgs.length; index++) {
    const option = pipArgs[index]!;
    if (operands || !option.startsWith('-')) { packages.push(option); continue; }
    const flag = ({'--no-index':'noIndex','--no-deps':'noDeps','--no-dependencies':'noDeps','--pre':'pre','--no-cache-dir':'noCache','-U':'upgrade','--upgrade':'upgrade','--force-reinstall':'forceReinstall'} as Partial<Record<string,'noIndex'|'noDeps'|'pre'|'noCache'|'upgrade'|'forceReinstall'>>)[option];
    if (!uninstall && flag) { controls[flag] = true; continue; }
    if (option === '--') { operands = true; continue; }
    if (option === '--help' || option === '-h') { help = true; continue; }
    if (uninstall && (option === '-y' || option === '--yes')) { yes = true; continue; }
    if (!uninstall) {
      const indexOption=option.split('=',1)[0];
      if(option.startsWith('-i')||indexOption==='--index-url'||indexOption==='--extra-index-url'){
        const value=option.startsWith('-i')&&option.length>2?option.slice(2):option.includes('=')?option.slice(option.indexOf('=')+1):pipArgs[++index];
        if(!value||value.startsWith('-'))throw new PythonInvocationError(option+' requires a URL');
        if(indexOption==='--extra-index-url')controls.extraIndexUrls=[...controls.extraIndexUrls??[],value];else controls.indexUrl=value;
        continue;
      }
      const kind = ['requirement','editable','constraint'].find(name => option.startsWith('-' + name[0]) || option.split('=',1)[0] === '--' + name);
      if (kind) {
        const prefix = '--' + kind;
        const path = option.startsWith(prefix + '=') ? option.slice(prefix.length + 1)
          : option === prefix || option.length === 2 ? pipArgs[++index] : option.slice(2);
        if (!path || path.startsWith('-')) throw new PythonInvocationError(option + ' requires a path');
        if(kind==='constraint')controls.constraintFiles=[...controls.constraintFiles??[],path];
        else if(kind==='editable')controls.editable=[...controls.editable??[],path];
        else requirements.push(path);
        continue;
      }
    }
    throw new PythonInvocationError('unsupported pip option ' + option);
  }
  if (!help && packages.length === 0 && requirements.length === 0 && !controls.editable?.length) throw new PythonInvocationError('pip ' + pipArgs[0] + ' requires at least one package or requirements file');
  return { packages, requirements, help, controls, ...(uninstall ? {uninstall,yes} : {}) };
}
