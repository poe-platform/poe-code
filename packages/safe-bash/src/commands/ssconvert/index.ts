import { createEngine, snapshotRuntimeFunctions, createResourceIO, createVfsOutput, runCommand, type EngineConfig, type ResourceIOOptions } from "poe-code/ssconvert";
import { retainFileSystemCleanup } from "@poe-code/safe-fs/core";
import {
  createOutputOperation,
  getCommandArguments,
  type CommandDefinition,
  type VirtualShellPlugin
} from "../../contracts/index.js";
import { shellValueByteLength } from "../../contracts/value.js";
import { writeFileOutput } from "../../contracts/filesystem-output.js";

export interface SsconvertCommandsOptions extends Omit<EngineConfig, "filesystem"> {
  readonly io?: Pick<ResourceIOOptions, "descriptors" | "adapters" | "transport">;
  readonly replace?: boolean;
  readonly profile?: import("poe-code/ssconvert").CommandProfile;
}
/** Explicit opt-in; the domain engine is the only conversion implementation. */
export function createSsconvertCommand(options: SsconvertCommandsOptions): CommandDefinition {
  if (options.replace !== undefined && typeof options.replace !== "boolean")
    throw new TypeError("ssconvert replace must be boolean");
  const binding = {
    ...options,
    ...(options.io === undefined ? {} : { io: Object.freeze({
      ...(options.io.descriptors === undefined ? {} : { descriptors: Object.freeze(Object.fromEntries(
        Object.entries(options.io.descriptors).map(([key, descriptor]) => [key, Object.freeze({ ...descriptor })])
      )) }),
      ...(options.io.adapters === undefined ? {} : { adapters: Object.freeze({ ...options.io.adapters }) }),
      ...(options.io.transport === undefined ? {} : { transport: Object.freeze({
        authorize: options.io.transport.authorize.bind(options.io.transport),
        request: options.io.transport.request.bind(options.io.transport),
        redirects: options.io.transport.redirects
      }) })
    }) }),
    ...(options.runtimeFunctions === undefined ? {} : { runtimeFunctions: snapshotRuntimeFunctions(options.runtimeFunctions) }),
    ...(options.profile === undefined ? {} : { profile: Object.freeze({
      ...options.profile,
      ...(options.profile.groups === undefined ? {} : { groups: Object.freeze({ ...options.profile.groups }) }),
      ...(options.profile.configurationRoots === undefined ? {} : {
        configurationRoots: Object.freeze({ ...options.profile.configurationRoots })
      })
    }) }),
    codecs: Object.freeze([...options.codecs]),
    limits: Object.freeze({ ...options.limits }),
    environment: Object.freeze({
      ...options.environment,
      env: Object.freeze({ ...options.environment.env })
    })
  };
  return {
    name: "ssconvert",
    description: "Explicitly bound TypeScript spreadsheet conversion engine",
    async execute(context) {
      context.signal.throwIfAborted();
      const owner = createOutputOperation(context, { async write() {} });
      const inputBytes = Math.min(
        binding.limits.inputBytes,
        context.inputBudget?.maxBytes ?? Infinity
      );
      let stdout: ReturnType<typeof createOutputOperation> | undefined;
      const standardOutput = { async write(bytes: Uint8Array) {
        stdout ??= owner.child(context.stdout);
        await stdout.output.write(bytes);
      } };
      let stderr: ReturnType<typeof createOutputOperation> | undefined;
      const standardError = { async write(bytes: Uint8Array) {
        stderr ??= owner.child(context.stderr);
        await stderr.output.write(bytes);
      } };
      const openOutput = createVfsOutput(context.fs, async (path, bytes, signal) => {
        await owner.acquire(() => writeFileOutput(context, bytes,
          async (data) => {
            const capabilities = await context.fs.capabilitiesFor?.(path, { signal }) ?? context.fs.capabilities;
            signal.throwIfAborted();
            if (context.fs.writeStream && capabilities.streamingWrite !== false)
              await context.fs.writeStream(path, (async function* () { yield data; })(), { signal });
            else await context.fs.writeFile(path, data, { signal });
          }), () => {});
      }, cleanup => retainFileSystemCleanup(context.fs,
        view => cleanup(path => view.rm(path)), { maxOperations: 1 }));
      let engine: ReturnType<typeof createEngine> | undefined;
      try {
        engine = createEngine({
          ...binding,
          environment: {
            ...binding.environment,
            env: Object.freeze({ ...context.env })
          },
          limits: { ...binding.limits, inputBytes },
          filesystem: createResourceIO({
            ...binding.io,
            cwd: context.cwd,
            descriptors: { ...binding.io?.descriptors,
              0: { source: context.stdin },
              1: { sink: standardOutput }
            },
            filesystem: {
            openOutput,
            async read(uri, signal) {
              try {
                const capabilities = await context.fs.capabilitiesFor?.(uri, { signal }) ?? context.fs.capabilities;
                signal.throwIfAborted();
                if (context.fs.readStream && capabilities.streamingRead !== false)
                  return context.fs.readStream(uri, { signal });
                const bytes = await owner.acquire(
                  () =>
                    context.fs.readFile(uri, {
                      signal,
                      maxBytes: inputBytes
                    }),
                  () => {}
                );
                context.inputBudget?.check(bytes.byteLength);
                return [bytes];
              } catch (error) {
                signal.throwIfAborted();
                throw error;
              }
            },
            async write(uri, bytes, signal) {
              try {
                await owner.acquire(
                  () =>
                    writeFileOutput(context, bytes, async (data) => {
                      const capabilities = await context.fs.capabilitiesFor?.(uri, { signal }) ?? context.fs.capabilities;
                      signal.throwIfAborted();
                      if (context.fs.writeStream && capabilities.streamingWrite !== false)
                        await context.fs.writeStream(uri, (async function* () { yield data; })(), { signal });
                      else await context.fs.writeFile(uri, data, { signal });
                    }),
                  () => {}
                );
              } catch (error) {
                signal.throwIfAborted();
                throw error;
              }
            }
            }
          })
        });
        const maximumArguments = binding.limits.argumentBytes ?? 1024 * 1024;
        const values = context.argumentValues?.values ?? context.args;
        let argumentBytes = 0;
        let refusal: string | undefined;
        if (values.length > maximumArguments) refusal = "ssconvert arguments limit exceeded";
        for (const value of values) {
          if (refusal) break;
          if (typeof value === "string" && value.length > maximumArguments - argumentBytes) {
            refusal = "ssconvert argument bytes limit exceeded";
            break;
          }
          argumentBytes += shellValueByteLength(value);
          if (argumentBytes > maximumArguments) refusal = "ssconvert argument bytes limit exceeded";
        }
        if (refusal) {
          await standardError.write(new TextEncoder().encode(`${refusal}\n`));
          owner.signal.throwIfAborted();
          return { exitCode: 1 };
        }
        const carrier = getCommandArguments(context);
        return await runCommand(
          carrier.args.map((_, index) => carrier.bytes(index)!),
          engine,
          {
            signal: owner.signal,
            ...(context.stdinIsDefault === undefined ? {} : { stdinIsDefault: context.stdinIsDefault }),
            stdout: standardOutput,
            stderr: standardError,
            registerCleanup: (cleanup) => owner.registerCleanup(cleanup)
          },
          binding.profile
        );
      } finally {
        try {
          await engine?.dispose();
        } finally {
          await owner.close();
        }
      }
    }
  };
}
export function ssconvertCommands(options: SsconvertCommandsOptions): VirtualShellPlugin {
  const command = createSsconvertCommand(options),
    replace = options.replace ?? false;
  return {
    name: "ssconvert-commands",
    setup(host) {
      if (!replace && host.commands.has(command.name))
        throw new Error(`Command already registered: ${command.name}`);
      host.commands.register(command, { replace });
    }
  };
}
