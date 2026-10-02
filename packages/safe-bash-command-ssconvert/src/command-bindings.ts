import { defaultSsconvertLimits } from "@poe-code/spreadsheet-engine";
import { snapshotRuntimeFunctions } from "./formulas/runtime-functions.js";
import { snapshotFormats } from "./codecs/format-provider.js";
import { createResourceIO, type ResourceIOOptions } from "./io/index.js";
import { createVfsOutput } from "./io/publication.js";
import { resolveVfsCwd } from "./io/cwd.js";
import { runCommand } from "./cli.js";
import type { Engine, EngineConfig, EngineOptions } from "./contracts.js";
import { retainFileSystemCleanup } from "@poe-code/safe-fs/core";
import {
  createOutputOperation,
  getCommandArguments,
  type CommandDefinition,
  type VirtualShellPlugin
} from "safe-bash-contracts";
import { builtInDirectContextExecutors, syncCommandEvaluators, type SyncCommandEvaluators } from "safe-bash-contracts/runtime-control";
import { shellValueByteLength } from "safe-bash-contracts/value";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output";

export interface SsconvertCommandsOptions extends Omit<EngineConfig, "filesystem" | "codecs" | "environment"> {
  readonly codecs?: EngineConfig["codecs"];
  readonly environment?: EngineOptions["environment"];
  readonly io?: Pick<ResourceIOOptions, "descriptors" | "adapters" | "transport">;
  readonly replace?: boolean;
  readonly profile?: import("./cli.js").CommandProfile;
}
export interface SsconvertCommandBindings {
  createSsconvertCommand(options?: SsconvertCommandsOptions): CommandDefinition;
  createSsconvertCommands(options?: SsconvertCommandsOptions): readonly CommandDefinition[];
  ssconvertCommands(options?: SsconvertCommandsOptions): VirtualShellPlugin;
}

/** Bind one shell implementation to either explicit formats or the compatibility composition. */
export function createCommandBindings(
  createEngine: (options: EngineOptions) => Engine,
  compatibilityDefaults = false,
  synchronousEvaluator?: SyncCommandEvaluators["evalSyncSsconvert"]
): SsconvertCommandBindings {
  /** Explicit opt-in; the domain engine is the only conversion implementation. */
  function createSsconvertCommand(options: SsconvertCommandsOptions = {}): CommandDefinition {
    if (synchronousEvaluator) syncCommandEvaluators.evalSyncSsconvert = synchronousEvaluator;
    const configured = { ...options };
    if (configured.replace !== undefined && typeof configured.replace !== "boolean")
      throw new TypeError("ssconvert replace must be boolean");
    const binding = {
      ...configured,
      ...(configured.io === undefined ? {} : { io: Object.freeze({
        ...(configured.io.descriptors === undefined ? {} : { descriptors: Object.freeze(Object.fromEntries(
          Object.entries(configured.io.descriptors).map(([key, descriptor]) => [key, Object.freeze({ ...descriptor })])
        )) }),
        ...(configured.io.adapters === undefined ? {} : { adapters: Object.freeze({ ...configured.io.adapters }) }),
        ...(configured.io.transport === undefined ? {} : { transport: Object.freeze({
          authorize: configured.io.transport.authorize.bind(configured.io.transport),
          request: configured.io.transport.request.bind(configured.io.transport),
          redirects: configured.io.transport.redirects
        }) })
      }) }),
      ...(configured.runtimeFunctions === undefined ? {} : { runtimeFunctions: snapshotRuntimeFunctions(configured.runtimeFunctions) }),
      ...(configured.profile === undefined ? {} : { profile: Object.freeze({
        ...configured.profile,
        ...(configured.profile.groups === undefined ? {} : { groups: Object.freeze({ ...configured.profile.groups }) }),
        ...(configured.profile.configurationRoots === undefined ? {} : {
          configurationRoots: Object.freeze({ ...configured.profile.configurationRoots })
        })
      }) }),
      codecs: Object.freeze([...(configured.codecs ?? [])]),
      ...(configured.formats === undefined ? {} : { formats: snapshotFormats(configured.formats) }),
      limits: Object.freeze({ ...defaultSsconvertLimits, ...configured.limits }),
      environment: Object.freeze({
        locale: "C", timezone: "UTC",
        ...configured.environment,
        env: Object.freeze({ ...configured.environment?.env })
      })
    };
    const command: CommandDefinition = {
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
          const cwd = await owner.acquire(() => resolveVfsCwd(context.cwd, context.env.PWD, context.fs, owner.signal), () => {});
          engine = createEngine({
            ...binding,
            environment: {
              ...binding.environment,
              cwd,
              env: Object.freeze({ ...context.env })
            },
            limits: { ...binding.limits, inputBytes },
            filesystem: createResourceIO({
              ...binding.io,
              cwd,
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
                        ...(inputBytes === Infinity ? {} : { maxBytes: inputBytes })
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
          const maximumArguments = binding.limits.argumentBytes ?? Infinity;
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
            const gc = (globalThis as { gc?: () => void }).gc;
            if (typeof gc === "function") {
              gc();
              gc();
            }
          }
        }
      }
    };
    if (compatibilityDefaults && Object.entries(configured).every(([key, value]) => key === "replace" || value === undefined)) {
      builtInDirectContextExecutors.add(command.execute);
    }
    return command;
  }
  function ssconvertCommands(options: SsconvertCommandsOptions = {}): VirtualShellPlugin {
    const commands = createSsconvertCommands(options),
      replace = options.replace ?? false;
    return {
      name: "ssconvert-commands",
      setup(host) {
        if (!replace && commands.some(command => host.commands.has(command.name)))
          throw new Error("Command already registered: ssconvert");
        for (const command of commands) host.commands.register(command, { replace });
      }
    };
  }

  function createSsconvertCommands(options: SsconvertCommandsOptions = {}): readonly CommandDefinition[] {
    return Object.freeze([createSsconvertCommand(options)]);
  }
  return { createSsconvertCommand, createSsconvertCommands, ssconvertCommands };
}
