import { PythonInvocationError } from './invocation.js';

export interface PythonInstallation {
  readonly packages: readonly string[];
  readonly requirements: readonly string[];
  readonly help: boolean;
}

export const pythonInstallationHelp = `Usage: python -m pip install [-r FILE | --requirement FILE] PACKAGE ...
Installs compatible wheels and dependencies using the configured Pyodide installer.
PACKAGE is a package requirement or a canonical filesystem wheel path.
Supported options: -r, --requirement, -h, --help, --.
All other pip options and commands are unsupported, including --upgrade,
--force-reinstall, --no-index, --no-deps, --target, --user, --prefix, --root, --editable,
--index-url, --extra-index-url, --find-links, --trusted-host, --require-hashes,
--constraint, --dry-run, --quiet, --verbose and cache/build/configuration flags.
Configure transport and integrity through the Python package SDK configuration.
`;

/** Recognize only the actual -m pip entrypoint, never application arguments. */
export function parsePythonInstallation(args: readonly string[]): PythonInstallation | undefined {
  let pipArgs: readonly string[] | undefined;
  scan: for (let index = 0; index < args.length; index++) {
    const option = args[index]!;
    if (option === '--' || option === '-' || !option.startsWith('-') || option.startsWith('--')) return undefined;
    for (let offset = 1; offset < option.length; offset++) {
      const flag = option[offset]!;
      if ('h?V'.includes(flag)) return undefined;
      if ('cmWX'.includes(flag)) {
        const operand = option.slice(offset + 1) || args[++index];
        if (flag === 'c') return undefined;
        if (flag === 'm') {
          if (operand !== 'pip') return undefined;
          pipArgs = args.slice(index + 1);
          break scan;
        }
        break;
      }
    }
  }
  if (!pipArgs) return undefined;
  const packages: string[] = [];
  const requirements: string[] = [];
  if (pipArgs.length === 0) return { packages, requirements, help: true };
  if (pipArgs[0] === '--help' || pipArgs[0] === '-h') {
    if (pipArgs.length > 1) throw new PythonInvocationError('unsupported pip option or argument after help: ' + pipArgs[1]);
    return { packages, requirements, help: true };
  }
  if (pipArgs[0] !== 'install') throw new PythonInvocationError('unsupported pip command ' + pipArgs[0]);
  let operands = false;
  let help = false;
  for (let index = 1; index < pipArgs.length; index++) {
    const option = pipArgs[index]!;
    if (operands || !option.startsWith('-')) { packages.push(option); continue; }
    if (option === '--') { operands = true; continue; }
    if (option === '--help' || option === '-h') { help = true; continue; }
    if (option === '-r' || option === '--requirement' || option.startsWith('--requirement=') || option.startsWith('-r')) {
      const path = option.startsWith('--requirement=') ? option.slice('--requirement='.length)
        : option !== '-r' && option.startsWith('-r') ? option.slice(2) : pipArgs[++index];
      if (!path || path.startsWith('-')) throw new PythonInvocationError(option + ' requires a path');
      requirements.push(path);
      continue;
    }
    throw new PythonInvocationError('unsupported pip option ' + option);
  }
  if (!help && packages.length === 0 && requirements.length === 0) throw new PythonInvocationError('pip install requires at least one package or requirements file');
  return { packages, requirements, help };
}
