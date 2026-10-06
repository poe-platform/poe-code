import type {PythonPackageInstallOptions} from './provisioning.js';
import { PythonInvocationError } from './invocation.js';

export interface PythonInstallation {
  readonly controls: PythonPackageInstallOptions;
  readonly packages: readonly string[];
  readonly requirements: readonly string[];
  readonly help: boolean;
  readonly uninstall?: boolean;
  readonly yes?: boolean;
}

export const pythonInstallationHelp = `Usage: python -m pip install [-r/--requirement FILE] [OPTIONS] PACKAGE ...
       python -m pip uninstall [-y/--yes] PACKAGE ...
Install options: --pre, -U/--upgrade, --force-reinstall, --no-cache-dir
Compatible wheels; configure transport with the Python package SDK.
Both accept -h/--help and --. Other pip operations are unsupported.
`;

/** Parse arguments after the validated Python pip module entrypoint. */
export function parsePythonInstallation(pipArgs: readonly string[]): PythonInstallation {
  const controls: {pre?:boolean;noCache?:boolean;upgrade?:boolean;forceReinstall?:boolean} = {};
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
    if (!uninstall && (option === '--pre' || option === '--no-cache-dir')) { controls[option === '--pre' ? 'pre' : 'noCache'] = true; continue; }
    if (!uninstall && (option === '-U' || option === '--upgrade' || option === '--force-reinstall')) { controls[option === '--force-reinstall' ? 'forceReinstall' : 'upgrade'] = true; continue; }
    if (option === '--') { operands = true; continue; }
    if (option === '--help' || option === '-h') { help = true; continue; }
    if (uninstall && (option === '-y' || option === '--yes')) { yes = true; continue; }
    if (!uninstall && (option === '-r' || option === '--requirement' || option.startsWith('--requirement=') || option.startsWith('-r'))) {
      const path = option.startsWith('--requirement=') ? option.slice('--requirement='.length)
        : option !== '-r' && option.startsWith('-r') ? option.slice(2) : pipArgs[++index];
      if (!path || path.startsWith('-')) throw new PythonInvocationError(option + ' requires a path');
      requirements.push(path);
      continue;
    }
    throw new PythonInvocationError('unsupported pip option ' + option);
  }
  if (!help && packages.length === 0 && requirements.length === 0) throw new PythonInvocationError('pip ' + pipArgs[0] + ' requires at least one package or requirements file');
  return { packages, requirements, help, controls, ...(uninstall ? {uninstall,yes} : {}) };
}
