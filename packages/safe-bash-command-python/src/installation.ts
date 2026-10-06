import type {PythonPackageInstallOptions} from './provisioning.js';
import { PythonInvocationError } from './invocation.js';

export interface PythonInstallation extends PythonPackageInstallOptions {
  readonly packages: readonly string[];
  readonly requirements: readonly string[];
  readonly help: boolean;
  readonly uninstall?: boolean;
  readonly yes?: boolean;
}

export const pythonInstallationHelp = `Usage: python -m pip install [-r/--requirement FILE] [--pre] [--no-cache-dir] PACKAGE ...
       python -m pip uninstall [-y/--yes] PACKAGE ...
Compatible wheels; configure transport with the Python package SDK.
Both accept -h/--help and --. Other pip operations are unsupported.
`;

/** Parse arguments after the validated Python pip module entrypoint. */
export function parsePythonInstallation(pipArgs: readonly string[]): PythonInstallation {
  const packages: string[] = [];
  const requirements: string[] = [];
  if (pipArgs.length === 0) return { packages, requirements, help: true };
  if (pipArgs[0] === '--help' || pipArgs[0] === '-h') {
    if (pipArgs.length > 1) throw new PythonInvocationError('unsupported pip option or argument after help: ' + pipArgs[1]);
    return { packages, requirements, help: true };
  }
  const uninstall = pipArgs[0] === 'uninstall';
  let yes = false;
  const controls: {pre?:boolean;noCache?:boolean} = {};
  if (!uninstall && pipArgs[0] !== 'install') throw new PythonInvocationError('unsupported pip command ' + pipArgs[0]);
  let operands = false;
  let help = false;
  for (let index = 1; index < pipArgs.length; index++) {
    const option = pipArgs[index]!;
    if (operands || !option.startsWith('-')) { packages.push(option); continue; }
    if (!uninstall && (option === '--pre' || option === '--no-cache-dir')) { controls[option === '--pre' ? 'pre' : 'noCache'] = true; continue; }
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
  return { packages, requirements, help, ...controls, ...(uninstall ? {uninstall,yes} : {}) };
}
