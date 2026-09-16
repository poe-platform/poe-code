/** An explicit compatibility failure, rendered as Python usage status 2. */
export class PythonInvocationError extends Error {
  constructor(message: string) { super(message); this.name = 'PythonInvocationError'; }
}

/** Extract native initialization flags without consuming script/module arguments. */
export function parsePythonInvocation(args: readonly string[], env: Readonly<Record<string, string>>): {
  readonly startupArgs: string[];
  readonly env: Record<string, string>;
} {
  const startupArgs: string[] = [];
  let informational = false;
  scan: for (let index = 0; index < args.length; index++) {
    const option = args[index]!;
    if (option === '--' || option === '-' || !option.startsWith('-')) break;
    if (option === '--help') { informational = true; break; }
    if (option === '--version') { informational = true; continue; }
    if (option.startsWith('--')) throw new PythonInvocationError('unsupported option ' + option);
    for (let offset = 1; offset < option.length; offset++) {
      const flag = option[offset]!;
      if (flag === 'h' || flag === '?') { informational = true; break scan; }
      if (flag === 'V') { informational = true; continue; }
      if ('cmWX'.includes(flag)) {
        const operand = option.slice(offset + 1) || args[++index];
        if (operand === undefined) throw new PythonInvocationError('argument expected for -' + flag);
        if (flag === 'c' || flag === 'm') break scan;
        if (flag === 'X') {
          const separator = operand.indexOf('=');
          const name = separator < 0 ? operand : operand.slice(0, separator);
          const value = separator < 0 ? undefined : operand.slice(separator + 1);
          let decimal = value ?? '';
          while (decimal.length && ' \t\n\r\v\f'.includes(decimal[0]!)) decimal = decimal.slice(1);
          if (decimal[0] === '+' || decimal[0] === '-') decimal = decimal.slice(1);
          const digits = decimal.length > 0 && [...decimal].every(character => character >= '0' && character <= '9');
          const supported = (name === 'utf8' && (value === undefined || value === '0' || value === '1'))
            || ((name === 'dev' || name === 'warn_default_encoding') && value === undefined)
            || (name === 'int_max_str_digits' && digits && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647 && (Number(value) === 0 || Number(value) >= 640));
          if (!supported) throw new PythonInvocationError('unsupported -X option ' + operand);
          startupArgs.push('-X', operand);
        }
        // Warning-as-error can prevent Pyodide bootstrap; apply -W after bootstrap.
        break;
      }
      if (!'BEPOusISbdvqR'.includes(flag)) throw new PythonInvocationError('unsupported option -' + flag);
      startupArgs.push('-' + flag);
    }
  }
  if (!informational && !startupArgs.includes('-E') && !startupArgs.includes('-I')) {
    if (env.PYTHONINSPECT) throw new PythonInvocationError('PYTHONINSPECT requires an interactive terminal, which the shell does not expose');
    if (env.PYTHONHOME) throw new PythonInvocationError('PYTHONHOME cannot replace the configured Pyodide runtime');
  }
  const runtimeEnv = { ...env };
  // These paths belong to the canonical filesystem, mounted after bootstrap.
  delete runtimeEnv.PYTHONPATH;
  delete runtimeEnv.PYTHONHOME;
  delete runtimeEnv.PYTHONWARNINGS;
  // Pyodide otherwise supplies PYTHONINSPECT=1, including with a -c operand.
  runtimeEnv.PYTHONINSPECT = '';
  // Without a command Pyodide initializes CPython in inspect mode.
  startupArgs.push('-c', '');
  return { startupArgs, env: runtimeEnv };
}
