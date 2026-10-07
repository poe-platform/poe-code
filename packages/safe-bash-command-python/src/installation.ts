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
         --pre, -U/--upgrade,
         --force-reinstall, --no-cache-dir
Both accept -h/--help and --.
`;

/** Parse arguments after the validated Python pip module entrypoint. */
export function parsePythonInstallation(pipArgs: readonly string[]): PythonInstallation {
  const controls: {pre?:boolean;noCache?:boolean;upgrade?:boolean;forceReinstall?:boolean;editable?:string[];constraintFiles?:string[]} = {};
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
    const flag = ({'--pre':'pre','--no-cache-dir':'noCache','-U':'upgrade','--upgrade':'upgrade','--force-reinstall':'forceReinstall'} as Partial<Record<string,'pre'|'noCache'|'upgrade'|'forceReinstall'>>)[option];
    if (!uninstall && flag) { controls[flag] = true; continue; }
    if (option === '--') { operands = true; continue; }
    if (option === '--help' || option === '-h') { help = true; continue; }
    if (uninstall && (option === '-y' || option === '--yes')) { yes = true; continue; }
    if (!uninstall) {
      const kind = ['requirement','editable','constraint'].find(name => option.startsWith('-' + name[0]) || option.split('=',1)[0] === '--' + name);
      if (kind) {
        const prefix = '--' + kind;
        const path = option.startsWith(prefix + '=') ? option.slice(prefix.length + 1)
          : option === prefix || option.length === 2 ? pipArgs[++index] : option.slice(2);
        if (!path || path.startsWith('-')) throw new PythonInvocationError(option + ' requires a path');
        (kind==='constraint'?controls.constraintFiles??=[]:kind === 'editable' ? controls.editable ??= [] : requirements).push(path);
        continue;
      }
    }
    throw new PythonInvocationError('unsupported pip option ' + option);
  }
  if (!help && packages.length === 0 && requirements.length === 0 && !controls.editable?.length) throw new PythonInvocationError('pip ' + pipArgs[0] + ' requires at least one package or requirements file');
  return { packages, requirements, help, controls, ...(uninstall ? {uninstall,yes} : {}) };
}
