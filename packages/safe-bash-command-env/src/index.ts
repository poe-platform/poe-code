import { shellValueByteLength } from "safe-bash-contracts/value";
import type { CommandDefinition, CommandHandler } from "safe-bash-contracts";
import { FsError, getCommandArguments } from "safe-bash-contracts";
import { writeDiagnostic } from "safe-bash-contracts/escaping";
import { define, output, pathOf, UsageError, value } from "safe-bash-io-engine/internal";
import { EnvSplitError, parseEnvOptions, type EnvSplitLimits } from "safe-bash-io-engine/commands/env-split";
import type { VirtualShellPlugin } from "safe-bash-contracts";
export interface EnvLimits { readonly maxArgumentBytes: number; }
export interface EnvCommandsOptions { readonly envSplitLimits?: EnvSplitLimits; readonly replace?: boolean; readonly execute?: CommandHandler; readonly limits?: Partial<EnvLimits>; }
export function createEnvCommand(options: EnvCommandsOptions = {}): CommandDefinition {
 const execute: CommandHandler = options.execute ?? (async context => { throw new FsError("ENOTSUP", { path: context.command }); });
 const max = options.limits?.maxArgumentBytes ?? Infinity; if (max !== Infinity && (!Number.isSafeInteger(max) || max < 1)) throw new RangeError("maxArgumentBytes must be positive");
 const definition = define("env", async context => {
  if (max !== Infinity) { let bytes = 0; for (const value of getCommandArguments(context).values) { bytes += shellValueByteLength(value); if (bytes > max) throw new FsError("EFBIG", { message: "argument byte limit exceeded" }); } }
      const argumentValues = getCommandArguments(context);
      const preserveLegacyStatus = argumentValues.args.some(arg => arg.startsWith("-S") || arg.startsWith("--split-string"))
        || (argumentValues.args.length === 1 && (argumentValues.args[0] === "-a" || argumentValues.args[0] === "--argv0"));
      let parsed: Awaited<ReturnType<typeof parseEnvOptions>>;
      let debug = false;
      let env: Record<string, string>;
      let names: string[];
      let offset = 0;
      let cwd = context.cwd;
      let argv0: string | undefined;
      try {
        parsed = await parseEnvOptions(argumentValues.args, context.env, context.signal, argumentValues, options.envSplitLimits);
        debug = parsed.flags.has("v");
        if (debug && parsed.flags.has("i")) await writeDiagnostic(context.stderr, "cleaning environ\n", context.signal);
        env = Object.assign(Object.create(null) as Record<string, string>, parsed.flags.has("i") ? {} : context.env);
        for (const name of parsed.values.get("u") ?? []) {
          if (!name || name.includes("=") || name.includes("\0")) throw new UsageError(`cannot unset '${name}': Invalid argument`);
          if (debug) await writeDiagnostic(context.stderr, `unset:    ${name}\n`, context.signal);
          delete env[name];
        }
        const inheritedNames = Object.keys(env);
        const addedNames: string[] = [];
        while (parsed.operands[offset]?.includes("=")) {
          const assignment = parsed.operands[offset++]!;
          const equals = assignment.indexOf("=");
          const name = assignment.slice(0, equals);
          if (name.includes("\0")) throw new UsageError("invalid environment variable name");
          const content = assignment.slice(equals + 1);
          if (content.includes("\0")) throw new UsageError("environment values cannot contain NUL");
          if (debug) await writeDiagnostic(context.stderr, `setenv:   ${assignment}\n`, context.signal);
          if (!Object.hasOwn(env, name)) addedNames.push(name);
          env[name] = content;
        }
        names = [...addedNames.reverse(), ...inheritedNames];
        if (offset < parsed.operands.length && parsed.flags.has("0")) throw new UsageError("cannot specify --null with a command");
        const directory = value(parsed, "C");
        if (directory !== undefined) {
          if (debug) await writeDiagnostic(context.stderr, `chdir:    '${directory}'\n`, context.signal);
          cwd = pathOf(context, directory);
          if ((await context.fs.stat(cwd, { signal: context.signal })).type !== "directory") throw new FsError("ENOTDIR", { path: cwd });
          cwd = await context.fs.realpath(cwd, { signal: context.signal });
        }
        argv0 = value(parsed, "a");
        if (argv0?.includes("\0")) throw new UsageError("argv0 cannot contain NUL");
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof EnvSplitError || (!preserveLegacyStatus && (error instanceof UsageError || error instanceof FsError))) {
          await writeDiagnostic(context.stderr, `${context.command}: ${(error as Error).message}\n`, context.signal);
          return { exitCode: 125 };
        }
        throw error;
      }
      if (offset < parsed.operands.length) {
        if (debug) {
          await writeDiagnostic(context.stderr, `executing: ${parsed.operands[offset]}\n`, context.signal);
          for (let index = offset; index < parsed.operands.length; index++) {
            await writeDiagnostic(context.stderr, `   arg[${index - offset}]= '${parsed.operands[index]}'\n`, context.signal);
          }
        }
        const childArguments = parsed.operandValues!.slice(offset + 1);
        const childEnv: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, Object.fromEntries(names.map(name => [name, env[name]!])));
        if (context.invoke) return context.invoke(parsed.operands[offset]!, childArguments.args, {
          argumentValues: childArguments, externalInvocation: true,
          ...(argv0 === undefined ? {} : { argv0 }),
          env: childEnv, replaceEnv: true, cwd, stdin: context.stdin, stdout: context.stdout, stderr: context.stderr,
          ...(context.stdinIsDefault === undefined ? {} : { stdinIsDefault: context.stdinIsDefault }),
        });
        return execute({ ...context, argv0, command: parsed.operands[offset]!, args: childArguments.args, argumentValues: childArguments, env: childEnv, cwd });
      }
      for (const name of names) await output(context, `${name}=${env[name]}${parsed.flags.has("0") ? "\0" : "\n"}`);
      return { exitCode: 0 };
    });
 return definition;
}
export function createEnvCommands(options: EnvCommandsOptions = {}): readonly CommandDefinition[] { return [createEnvCommand(options)]; }
export function envCommands(options: EnvCommandsOptions = {}): VirtualShellPlugin { const commands = createEnvCommands(options); return { name: "env-commands", setup(host) { if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`); for (const command of commands) host.commands.register(command, {replace: options.replace ?? false}); } }; }
