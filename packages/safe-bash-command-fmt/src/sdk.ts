import { shellValueByteLength } from 'safe-bash-contracts/value';
import { FmtError, type FmtLimits } from './contracts.js';
import { ownedBytes } from './bytes.js';

export interface FmtFormattingOptions {
  readonly width?: number;
  readonly goal?: number;
  readonly crown?: boolean;
  readonly tagged?: boolean;
  readonly split?: boolean;
  readonly uniform?: boolean;
  readonly prefix?: string | Uint8Array;
  readonly files?: readonly string[];
}
const formattingKeys = ['width', 'goal', 'crown', 'tagged', 'split', 'uniform', 'prefix', 'files'] as const;
/** Capture bounded SDK values as argv so native option validation stays shared. */
export function captureFmtArguments(options: FmtFormattingOptions & { readonly arguments?: readonly Uint8Array[] }, limits: FmtLimits): readonly Uint8Array[] | undefined {
  const typed = formattingKeys.some(key => options[key] !== undefined);
  if (options.arguments !== undefined && typed) throw new FmtError('OPTION', 'SDK arguments cannot be combined with formatting options');
  if (options.arguments === undefined && !typed) return undefined;
  const args: Uint8Array[] = [];
  let extent = 0;
  const append = (value: string | Uint8Array): void => {
    if (args.length >= 4096) throw new FmtError('LIMIT', 'argument count limit exceeded');
    let bytes: Uint8Array;
    if (typeof value === 'string') {
      if (value.length > limits.argumentBytes - extent || shellValueByteLength(value) > limits.argumentBytes - extent) throw new FmtError('LIMIT', 'Argument byte limit exceeded');
      bytes = new TextEncoder().encode(value);
    } else bytes = ownedBytes(value, limits.argumentBytes - extent);
    extent += bytes.length;
    args.push(bytes);
  };
  if (options.arguments !== undefined) {
    if (options.arguments.length > 4096) throw new FmtError('LIMIT', 'argument count limit exceeded');
    for (const argument of options.arguments) append(argument);
  } else {
    for (const key of ['width', 'goal'] as const) {
      const value = options[key];
      if (value !== undefined) {
        if (!Number.isSafeInteger(value) || value < 0) throw new FmtError('WIDTH', 'SDK widths must be nonnegative safe integers');
        append(key === 'width' ? '-w' : '-g'); append(String(value));
      }
    }
    for (const [key, flag] of [['crown', '-c'], ['tagged', '-t'], ['split', '-s'], ['uniform', '-u']] as const) {
      const value = options[key];
      if (value !== undefined && typeof value !== 'boolean') throw new FmtError('OPTION', `SDK ${key} must be boolean`);
      if (value) append(flag);
    }
    if (options.prefix !== undefined) { append('-p'); append(options.prefix); }
    append('--');
    if (options.files !== undefined) {
      if (options.files.length > 4096) throw new FmtError('LIMIT', 'argument count limit exceeded');
      for (const file of options.files) {
        if (typeof file !== 'string') throw new FmtError('OPTION', 'SDK files must be literal VFS paths');
        append(file);
      }
    }
  }
  return args;
}
