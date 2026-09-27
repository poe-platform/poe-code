import {
  collectBytes,
  commandRuntimeIdentity,
  writeBytes,
  writeText,
  type ByteSource,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin,
} from "safe-bash-contracts";

export interface EnvsubstLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxArgumentBytes: number;
}

export interface EnvsubstCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly maxInputBytes?: number | undefined;
  readonly maxOutputBytes?: number | undefined;
  readonly limits?: Partial<EnvsubstLimits> | undefined;
}

export type EnvsubstOptions = EnvsubstCommandsOptions;

export function settings(options: EnvsubstCommandsOptions = {}): EnvsubstLimits {
  const limits: EnvsubstLimits = {
    maxInputBytes: options.limits?.maxInputBytes ?? options.maxInputBytes ?? 16 * 1024 * 1024,
    maxOutputBytes: options.limits?.maxOutputBytes ?? options.maxOutputBytes ?? 16 * 1024 * 1024,
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? 64 * 1024,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  return limits;
}

const HELP_TEXT = `Usage: envsubst [OPTION] [SHELL-FORMAT]

Substitutes the values of environment variables.

Operation mode:
  -v, --variables             output the variables occurring in SHELL-FORMAT

Informative output:
  -h, --help                  display this help and exit
  -V, --version               output version information and exit

In normal operation mode, standard input is copied to standard output,
with references to environment variables of the form $VARIABLE or \${VARIABLE}
being replaced with the corresponding values.  If a SHELL-FORMAT is given,
only those environment variables that are referenced in SHELL-FORMAT are
substituted; otherwise all environment variables references occurring in
standard input are substituted.
`;

const VERSION_TEXT = `envsubst (Sandbox VFS-ish/GNU gettext-runtime) 0.22.5
`;

function isIdentStart(byte: number): boolean {
  return (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || byte === 95;
}

function isIdentPart(byte: number): boolean {
  return isIdentStart(byte) || (byte >= 48 && byte <= 57);
}

const sharedEncoder = new TextEncoder();
const sharedDecoder = new TextDecoder();

export function extractVariablesFromBytes(bytes: Uint8Array): string[] {
  const vars: string[] = [];
  let i = 0;
  while (i < bytes.byteLength) {
    if (bytes[i] !== 36) { // '$'
      i++;
      continue;
    }
    if (i + 1 >= bytes.byteLength) {
      i++;
      continue;
    }
    const next = bytes[i + 1]!;
    if (next === 123) { // '{'
      let j = i + 2;
      if (j < bytes.byteLength && isIdentStart(bytes[j]!)) {
        j++;
        while (j < bytes.byteLength && isIdentPart(bytes[j]!)) j++;
        if (j < bytes.byteLength && bytes[j] === 125) { // '}'
          vars.push(sharedDecoder.decode(bytes.subarray(i + 2, j)));
          i = j + 1;
          continue;
        }
      }
      i++;
      continue;
    }
    if (isIdentStart(next)) {
      let j = i + 2;
      while (j < bytes.byteLength && isIdentPart(bytes[j]!)) j++;
      vars.push(sharedDecoder.decode(bytes.subarray(i + 1, j)));
      i = j;
      continue;
    }
    i++;
  }
  return vars;
}

export function substituteBytes(
  input: Uint8Array,
  env: Readonly<Record<string, string | undefined>>,
  allowedVars: ReadonlySet<string> | undefined,
  maxOutputBytes: number
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalOut = 0;
  const pushChunk = (chunk: Uint8Array) => {
    if (chunk.byteLength === 0) return;
    totalOut += chunk.byteLength;
    if (totalOut > maxOutputBytes) {
      throw new Error("envsubst: output byte budget exceeded");
    }
    chunks.push(chunk);
  };

  let segStart = 0;
  let i = 0;
  while (i < input.byteLength) {
    if (input[i] !== 36) {
      i++;
      continue;
    }
    if (i + 1 >= input.byteLength) {
      i++;
      continue;
    }
    const next = input[i + 1]!;
    let varName: string | undefined;
    let endIdx = i;

    if (next === 123) {
      let j = i + 2;
      if (j < input.byteLength && isIdentStart(input[j]!)) {
        j++;
        while (j < input.byteLength && isIdentPart(input[j]!)) j++;
        if (j < input.byteLength && input[j] === 125) {
          varName = sharedDecoder.decode(input.subarray(i + 2, j));
          endIdx = j + 1;
        }
      }
    } else if (isIdentStart(next)) {
      let j = i + 2;
      while (j < input.byteLength && isIdentPart(input[j]!)) j++;
      varName = sharedDecoder.decode(input.subarray(i + 1, j));
      endIdx = j;
    }

    if (varName !== undefined && (allowedVars === undefined || allowedVars.has(varName))) {
      pushChunk(input.subarray(segStart, i));
      const val = env[varName] ?? "";
      pushChunk(sharedEncoder.encode(val));
      i = endIdx;
      segStart = i;
    } else if (varName !== undefined) {
      i = endIdx;
    } else {
      i++;
    }
  }
  pushChunk(input.subarray(segStart, input.byteLength));

  const out = new Uint8Array(totalOut);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export function createEnvsubstCommand(options: EnvsubstCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name: "envsubst",
    description: "Substitute environment variable values in shell format strings",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
      context.signal.throwIfAborted();
      let argBytes = 0;
      for (const arg of context.args) {
        argBytes += sharedEncoder.encode(arg).byteLength;
        if (argBytes > limits.maxArgumentBytes) {
          await writeText(context.stderr, "envsubst: argument budget exceeded\n");
          return { exitCode: 1 };
        }
      }

      let variablesMode = false;
      const operands: string[] = [];
      let endOfOptions = false;

      for (let i = 0; i < context.args.length; i++) {
        const arg = context.args[i]!;
        if (!endOfOptions && arg === "--") {
          endOfOptions = true;
          continue;
        }
        if (!endOfOptions && (arg === "--help" || arg === "-h")) {
          await writeText(context.stdout, HELP_TEXT);
          return { exitCode: 0 };
        }
        if (!endOfOptions && (arg === "--version" || arg === "-V")) {
          await writeText(context.stdout, VERSION_TEXT);
          return { exitCode: 0 };
        }
        if (!endOfOptions && (arg === "--variables" || arg === "-v")) {
          variablesMode = true;
          continue;
        }
        if (!endOfOptions && arg.startsWith("-")) {
          await writeText(context.stderr, `envsubst: invalid option '${arg}'\n`);
          return { exitCode: 1 };
        }
        operands.push(arg);
      }

      if (operands.length > 1) {
        await writeText(context.stderr, "envsubst: too many arguments\n");
        return { exitCode: 1 };
      }

      if (variablesMode) {
        if (operands.length === 0) {
          await writeText(context.stderr, "envsubst: missing arguments\n");
          return { exitCode: 1 };
        }
        const vars = extractVariablesFromBytes(sharedEncoder.encode(operands[0]!));
        if (vars.length > 0) {
          await writeText(context.stdout, `${vars.join("\n")}\n`);
        }
        return { exitCode: 0 };
      }

      const allowedVars = operands.length === 1
        ? new Set(extractVariablesFromBytes(sharedEncoder.encode(operands[0]!)))
        : undefined;

      const input = await collectBytes(context.stdin as ByteSource, { signal: context.signal });
      if (input.byteLength > limits.maxInputBytes) {
        await writeText(context.stderr, "envsubst: input byte budget exceeded\n");
        return { exitCode: 1 };
      }

      try {
        const output = substituteBytes(input, context.env, allowedVars, limits.maxOutputBytes);
        if (output.byteLength > 0) {
          await writeBytes(context.stdout, output);
        }
        return { exitCode: 0 };
      } catch (err) {
        await writeText(context.stderr, `${err instanceof Error ? err.message : "envsubst: error"}\n`);
        return { exitCode: 1 };
      }
    },
  };
}

export function createEnvsubstCommands(options: EnvsubstCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createEnvsubstCommand(options)]);
}

export function envsubstCommands(options: EnvsubstCommandsOptions = {}): VirtualShellPlugin {
  const commands = createEnvsubstCommands(options);
  return {
    name: "envsubst-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) {
            throw new Error(`Command already registered: ${command.name}`);
          }
        }
      }
      for (const command of commands) {
        host.commands.register(command, { replace: options.replace ?? false });
      }
    },
  };
}
