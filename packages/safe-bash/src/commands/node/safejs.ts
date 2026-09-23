import { dirname, resolvePath } from "../../contracts/path.js";
import type { CommandDefinition } from "../../contracts/command.js";
import type { VirtualShellPlugin } from "../../contracts/plugin.js";
import { onlyKeys, record } from "../../integrations/safejs/values.js";
import { UsageError } from "../internal.js";
import { bufferBindings, bufferSource } from "./buffer.js";
import { timerBindings, timerSource } from "./timers.js";
import { nodeRequireSource } from "./preload.js";
import { SafeJsCommandLimitError } from "../safejs/types.js";
import { nodeReadFile } from "./filesystem.js";
import { createNodePathModule } from "./path.js";
import { createSafeJsCommands } from "../safejs/runtime.js";
import { commandLimits } from "../safejs/options.js";
import type { Invocation } from "../safejs/options.js";
import type { SafeJsHostFunction } from "../safejs/types.js";
import type { NodeSafeJsCommandOptions } from "./types.js";

export type SafeJsNodeCommandsOptions<Budget = unknown> = NodeSafeJsCommandOptions<Budget> & { readonly replace?: boolean };

export function createSafeJsNodeCommands<Budget>(options: SafeJsNodeCommandsOptions<Budget>): readonly CommandDefinition[] {
  const settings = record(options, "node options");
  onlyKeys(settings, ["runtime", "limits", "replace"]);
  if (Object.hasOwn(settings, "replace") && typeof settings.replace !== "boolean") throw new TypeError("node replace must be boolean");
  delete settings.replace;
  return Object.freeze([createSafeJsNodeCommand(settings as unknown as NodeSafeJsCommandOptions<Budget>)]);
}

export function safeJsNodeCommands<Budget>(options: SafeJsNodeCommandsOptions<Budget>): VirtualShellPlugin {
  const definitions = createSafeJsNodeCommands(options);
  const replace = options.replace ?? false;
  return { name: "node-commands", setup(host) {
    if (!replace && host.commands.has("node")) throw new Error("Command already registered: node");
    for (const definition of definitions) host.commands.register(definition, { replace });
  } };
}

function invocation(args: readonly string[]): Invocation {
  let source: string | undefined;
  let print = false;
  let check = false;
  const preloads: string[] = [];
  let inputType: "module" | undefined;
  let index = 0;
  for (; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--") { index++; break; }
    if (argument === "-h" || argument === "--help") return { file: "-", args: [], print: false, help: true };
    if (argument === "--require" || argument.startsWith("--require=") || argument.startsWith("-r")) {
      const name = argument === "--require" || argument === "-r" ? args[++index]
        : argument.startsWith("--require=") ? argument.slice(10) : argument.slice(2);
      if (!name) throw new UsageError(`${argument} requires a module operand`);
      preloads.push(name);
      continue;
    }
    if (argument === "--input-type" || argument.startsWith("--input-type=")) {
      const value = argument === "--input-type" ? args[++index] : argument.slice(13);
      if (value !== "module") throw new UsageError("SafeJS node supports only --input-type=module");
      inputType = value;
      continue;
    }
    if (argument === "--check" || argument === "-c") {
      if (source !== undefined) throw new UsageError("conflicting source selectors");
      check = true;
      continue;
    }
    const mode = argument === "--eval" || argument.startsWith("--eval=") || argument.startsWith("-e") ? "eval"
      : argument === "--print" || argument.startsWith("--print=") || argument.startsWith("-p") ? "print" : undefined;
    if (mode) {
      if (source !== undefined || check) throw new UsageError("conflicting source selectors");
      print = mode === "print";
      const equal = argument.indexOf("=");
      source = argument.startsWith("--") ? equal >= 0 ? argument.slice(equal + 1) : args[++index]
        : argument.length > 2 ? argument.slice(2) : args[++index];
      if (source === undefined) throw new UsageError(`${argument} requires JavaScript source`);
      continue;
    }
    if (argument !== "-" && argument.startsWith("-")) throw new UsageError(`unsupported node option '${argument}'`);
    break;
  }
  if (source !== undefined) return { source, file: print ? "<node -p>" : "<node -e>", args: args.slice(index), print, help: false, preloads, ...(inputType ? { inputType } : {}) };
  return { file: args[index] ?? "-", args: args.slice(index + 1), print: false, help: false, check, preloads, ...(inputType ? { inputType } : {}) };
}

export function createSafeJsNodeCommand<Budget>(options: NodeSafeJsCommandOptions<Budget>): CommandDefinition {
  const settings = record(options, "node options");
  onlyKeys(settings, ["runtime", "limits"]);
  if (settings.runtime === undefined || settings.runtime === null) throw new TypeError("node requires an injected SafeJS runtime");
  options = settings as unknown as NodeSafeJsCommandOptions<Budget>;
  const limits = commandLimits(options.limits);
  const definitions = createSafeJsCommands(options, {
    name: "node",
    description: "Execute JavaScript with an injected SafeJS runtime and virtual I/O",
    help: "Usage: node [--check | -e SOURCE | -p EXPRESSION] [FILE | -] [ARG...]\nExecutes with the injected SafeJS interpreter; no native Node.js process.\nSupports --check/-c (inject parseSourceModule), --eval, --print, --input-type=module and -- before operands.\nNo source operand reads stdin. Files and inline source leave stdin for guest data.\nUse async imports from fs or require(\"node:fs/promises\").\nUse fs.readFileSync(path, encoding) for synchronous guest text reads.\nImport or require path or node:path for virtual POSIX path helpers.\nUse --require/-r to preload virtual .cjs, .js or .json modules.\nRequire explicit virtual module paths; native modules and package search are not supported.\n",
    invocation,
    prepare(source, selected, modules, lifecycle) {
      const command = modules.command!;
      const directory = selected.inputType === "module" || selected.source === undefined && selected.file.endsWith(".mjs")
        ? undefined : selected.source !== undefined || selected.file === "-" ? "." : dirname(selected.file);
      const stdio = modules.stdio!;
      const fs = modules.fs!;
      const pending = new Set<Promise<void>>();
      const processModule = {
        argv: ["/virtual/bin/node", ...(selected.source === undefined ? [selected.file] : []), ...selected.args],
        env: command.env,
        cwd: options.runtime.declareHostOperation(() => command.cwd, "read-side-effect"),
        exitCode: 0,
        stdin: { readText: stdio.readText, readBytes: stdio.readBytes },
        stdout: { write: stdio.write },
        stderr: { write: stdio.error },
      };
      const nodeFs = {
        ...fs,
        readFile: nodeReadFile(options, fs, lifecycle.signal, lifecycle.fail, pending),
        promises: fs,
        readFileSync: options.runtime.declareHostOperation(
          // Give the synchronous facade its own declaration so readFile stays asynchronous.
          (fs.readFile as SafeJsHostFunction).bind(undefined),
          "read-side-effect", { awaitResult: true },
        ),
      };
      modules.fs = { ...nodeFs, default: nodeFs };
      const path = createNodePathModule(options.runtime, command.cwd as string);
      const requiredModules = new Map([["fs", nodeFs], ["node:fs", nodeFs], ["fs/promises", fs], ["node:fs/promises", fs], ["path", path], ["node:path", path]]);
      for (const [name, module] of requiredModules) modules[name] = { ...module, default: module };
      const prefix = bufferSource + timerSource + (directory === undefined ? "" : "let __dirname = __safeBashDirectory;\n") + nodeRequireSource;
      let remainingSourceBytes = limits.maxSourceBytes - lifecycle.sourceBytes;
      const printing = selected.print;
      return {
        importSpecifiers: [...requiredModules.keys()],
        source: prefix + (printing ? `console.log((\n${source}\n));` : source) + "\n;await __safeBashTimers.drain(); __safeBashSetExitCode(process.exitCode);",
        bindings: {
          ...(directory === undefined ? {} : { __safeBashDirectory: directory }),
          __safeBashBuffer: bufferBindings(options),
          __safeBashTimers: timerBindings(options, lifecycle.signal, lifecycle.fail, pending),
          process: processModule, __safeBashSetExitCode: command.setExitCode,
          __safeBashPreloads: selected.preloads ?? [],
          __safeBashCwd: command.cwd,
          __safeBashEntryDirectory: selected.source === undefined && selected.file !== "-" ? dirname(selected.file) : command.cwd,
          __safeBashModuleRead: options.runtime.declareHostOperation(async (path: unknown) => {
            if (typeof path !== "string") throw new TypeError("module path must be a string");
            const value = await lifecycle.readSource(path, remainingSourceBytes);
            remainingSourceBytes -= Buffer.byteLength(value);
            if (remainingSourceBytes < 0) {
              const error = new SafeJsCommandLimitError("maxSourceBytes");
              lifecycle.fail(error);
              throw error;
            }
            return value;
          }, "read-side-effect", { awaitResult: true }),
          __safeBashModulePath: options.runtime.declareHostOperation((base: unknown, name: unknown) => {
            if (typeof name !== "string" || typeof base !== "string") throw new TypeError("module name must be a string");
            if (!(name.startsWith("./") || name.startsWith("../") || name.startsWith("/"))) return null;
            if (name.includes("\0") || !(name.endsWith(".json") || name.endsWith(".js") || name.endsWith(".cjs"))) {
              throw new TypeError("Unsupported node module; use an explicit .cjs, .js or .json path");
            }
            return resolvePath(base, name);
          }, "read-side-effect"),
          __safeBashRequire: options.runtime.declareHostOperation((name: unknown) => {
            const module = typeof name === "string" ? requiredModules.get(name) : undefined;
            if (!module) throw new TypeError("Unsupported node module; use fs, node:fs, fs/promises, node:fs/promises, path or node:path");
            return module;
          }, "read-side-effect"),
        },
      };
    },
  });
  return Object.freeze(definitions[0]!);
}
