import { dirname, resolvePath } from "../../contracts/path.js";
import type { CommandDefinition } from "../../contracts/command.js";
import type { VirtualShellPlugin } from "../../contracts/plugin.js";
import { onlyKeys, record } from "../../integrations/safejs/values.js";
import { UsageError } from "../internal.js";
import { bufferBindings, bufferSource } from "./buffer.js";
import { timerBindings, timerSource } from "./timers.js";
import { nodeRequireSource } from "./preload.js";
import { SafeJsCommandLimitError } from "../safejs/types.js";
import { nodeSourceLocation } from "./source-maps.js";
import { nodeReadFile } from "./filesystem.js";
import { createNodePathModule } from "./path.js";
import { createSafeJsCommands } from "../safejs/runtime.js";
import { commandLimits } from "../safejs/options.js";
import type { Invocation } from "../safejs/options.js";
import type { SafeJsHostFunction } from "../safejs/types.js";
import type { NodeSafeJsCommandOptions } from "./types.js";
import { nodeEnvironment } from "./environment.js";

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

function invocation(args: readonly string[], metadata: import("../safejs/types.js").SafeJsRuntime<unknown>["node"]): Invocation {
  let source: string | undefined;
  let print = false;
  let check = false;
  let sourceMaps = false;
  const preloads: string[] = [];
  const nodeOptions: string[] = [];
  const envFiles: { path: string; optional: boolean }[] = [];
  let inputType: "module" | "commonjs" | undefined;
  let index = 0;
  for (; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--") { index++; break; }
    if (argument === "-h" || argument === "--help") return { file: "-", args: [], print: false, help: true };
    if (argument === "-v" || argument === "--version") {
      if (!metadata?.version) throw new UsageError("inject runtime.node.version to report the actual runtime identity");
      return { file: "-", args: [], print: false, help: false, output: metadata.version + "\n" };
    }
    if (argument === "--completion-bash") {
      const flags = ["--help", "--version", "--completion-bash", "--check", "--eval", "--print", "--input-type", "--require", "--enable-source-maps", "--env-file", "--env-file-if-exists", ...Object.keys(metadata?.options ?? {})];
      return { file: "-", args: [], print: false, help: false, output: `_node_complete() {\n  local cur_word="\${COMP_WORDS[COMP_CWORD]}"\n  COMPREPLY=( $(compgen -W '${flags.join(" ")}' -- "$cur_word") )\n}\ncomplete -F _node_complete node\n` };
    }
    const equal = argument.indexOf("=");
    const flag = equal < 0 ? argument : argument.slice(0, equal);
    if (flag === "--env-file" || flag === "--env-file-if-exists") {
      const path = equal < 0 ? args[++index] : argument.slice(equal + 1);
      if (!path) throw new UsageError(`${flag} requires a file operand`);
      envFiles.push({ path, optional: flag === "--env-file-if-exists" });
      continue;
    }
    if (Object.hasOwn(metadata?.options ?? {}, flag)) {
      const kind = metadata!.options![flag];
      if (kind === "boolean") {
        if (equal >= 0) throw new UsageError(`${flag} does not accept a value`);
        nodeOptions.push(flag);
      } else {
        const value = equal < 0 ? args[++index] : argument.slice(equal + 1);
        if (!value || value.startsWith("--")) throw new UsageError(`${flag} requires a value`);
        nodeOptions.push(flag + "=" + value);
      }
      continue;
    }
    if (argument === "--enable-source-maps") { sourceMaps = true; continue; }
    if (argument === "--require" || argument.startsWith("--require=") || argument.startsWith("-r")) {
      const name = argument === "--require" || argument === "-r" ? args[++index]
        : argument.startsWith("--require=") ? argument.slice(10) : argument.slice(2);
      if (!name) throw new UsageError(`${argument} requires a module operand`);
      preloads.push(name);
      continue;
    }
    if (argument === "--input-type" || argument.startsWith("--input-type=")) {
      const value = argument === "--input-type" ? args[++index] : argument.slice(13);
      if (value !== "module" && value !== "commonjs") throw new UsageError("SafeJS node supports --input-type=module or --input-type=commonjs");
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
  if (source !== undefined) return { source, file: print ? "<node -p>" : "<node -e>", args: args.slice(index), print, help: false, preloads, sourceMaps, nodeOptions, envFiles, ...(inputType ? { inputType } : {}) };
  if (inputType === "commonjs" && args[index] !== undefined && args[index] !== "-") throw new UsageError("--input-type can only be used with eval, print or stdin source");
  return { file: args[index] ?? "-", args: args.slice(index + 1), print: false, help: false, check, preloads, sourceMaps, nodeOptions, envFiles, ...(inputType ? { inputType } : {}) };
}

export function createSafeJsNodeCommand<Budget>(options: NodeSafeJsCommandOptions<Budget>): CommandDefinition {
  const settings = record(options, "node options");
  onlyKeys(settings, ["runtime", "limits"]);
  if (settings.runtime === undefined || settings.runtime === null) throw new TypeError("node requires an injected SafeJS runtime");
  options = settings as unknown as NodeSafeJsCommandOptions<Budget>;
  const limits = commandLimits(options.limits);
  const suppliedMetadata = options.runtime.node;
  const metadata = suppliedMetadata ? { ...(suppliedMetadata.version !== undefined ? { version: suppliedMetadata.version } : {}), options: Object.freeze({ ...suppliedMetadata.options }) } : undefined;
  if (metadata?.version !== undefined && (typeof metadata.version !== "string" || !metadata.version || metadata.version.includes("\n") || metadata.version.includes("\0"))) throw new TypeError("Invalid runtime.node.version");
  for (const [flag, kind] of Object.entries(metadata?.options ?? {})) {
    if (!flag.startsWith("--") || flag.length < 3 || ![...flag.slice(2)].every(char => "abcdefghijklmnopqrstuvwxyz0123456789-".includes(char)) || (kind !== "boolean" && kind !== "value")) throw new TypeError("Invalid runtime.node.options");
  }
  const definitions = createSafeJsCommands(options, {
    name: "node",
    description: "Execute JavaScript with an injected SafeJS runtime and virtual I/O",
    help: "Usage: node [--check | -e SOURCE | -p EXPRESSION] [FILE | -] [ARG...]\nExecutes with the injected SafeJS interpreter; no native Node.js process.\nSupports --check/-c (inject parseSourceModule), --eval, --print, and --enable-source-maps.\nUse --input-type=module or --input-type=commonjs and -- before operands.\nNo source operand reads stdin. Files and inline source leave stdin for guest data.\nUse async imports from fs or require(\"node:fs/promises\").\nUse fs.readFileSync(path, encoding) for synchronous guest text reads.\nImport or require path or node:path for virtual POSIX path helpers.\nUse --require/-r to preload virtual .cjs, .js or .json modules.\nRequire explicit virtual module paths; native modules and package search are not supported.\n",
    invocation: args => invocation(args, metadata),
    transformSource(source, selected) {
      if (selected.inputType !== "commonjs") return source;
      if (source.startsWith("#!")) {
        const newline = source.indexOf("\n");
        source = newline < 0 ? "" : source.slice(newline);
      }
      const filename = selected.source === undefined ? "[stdin]" : "[eval]";
      const body = selected.print ? `console.log((\n${source}\n));` : source;
      return `
const __safeBashCommonJs = { exports: {} };
(function(exports, require, module, __filename, __dirname) {
${selected.check ? body : `eval(${JSON.stringify(body)});`}
}).call(globalThis, __safeBashCommonJs.exports, require, __safeBashCommonJs, ${JSON.stringify(filename)}, ".");
`;
    },
    async prepare(source, selected, modules, lifecycle) {
      const command = modules.command!;
      let remainingSourceBytes = limits.maxSourceBytes - lifecycle.sourceBytes;
      const env = await nodeEnvironment(selected.envFiles ?? [], command.env as Record<string, string>, command.cwd as string, async (path, maxBytes) => {
        const value = await lifecycle.readSource(path, maxBytes);
        remainingSourceBytes -= Buffer.byteLength(value);
        return value;
      }, lifecycle.signal, remainingSourceBytes);
      const directory = selected.inputType === "module" || selected.source === undefined && selected.file.endsWith(".mjs")
        ? undefined : selected.source !== undefined || selected.file === "-" ? "." : dirname(selected.file);
      const stdio = modules.stdio!;
      const fs = modules.fs!;
      const pending = new Set<Promise<void>>();
      const processModule = {
        argv: ["/virtual/bin/node", ...(selected.source === undefined ? [selected.file] : []), ...selected.args],
        env,
        cwd: options.runtime.declareHostOperation(() => command.cwd, "read-side-effect"),
        exitCode: 0,
        stdin: { readText: stdio.readText, readBytes: stdio.readBytes },
        stdout: { write: stdio.write },
        stderr: { write: stdio.error },
      };
      const nodeFs = {
        ...fs,
        promises: fs,
        ...(typeof fs.readFile === "function" ? {
          readFile: nodeReadFile(options, fs, lifecycle.signal, lifecycle.fail, pending),
          readFileSync: options.runtime.declareHostOperation(
            // Give the synchronous facade its own declaration so readFile stays asynchronous.
            (fs.readFile as SafeJsHostFunction).bind(undefined),
            "read-side-effect", { awaitResult: true },
          ),
        } : {}),
      };
      modules.fs = { ...nodeFs, default: nodeFs };
      const path = createNodePathModule(options.runtime, command.cwd as string);
      const requiredModules = new Map([["fs", nodeFs], ["node:fs", nodeFs], ["fs/promises", fs], ["node:fs/promises", fs], ["path", path], ["node:path", path]]);
      for (const [name, module] of requiredModules) modules[name] = { ...module, default: module };
      const prefix = bufferSource + timerSource + (directory === undefined ? "" : "let __dirname = __safeBashDirectory;\n") + nodeRequireSource;
      const printing = selected.print && selected.inputType !== "commonjs";
      const sourceLocation = selected.sourceMaps
        ? await nodeSourceLocation(source, selected.file, command.cwd as string, prefix + (printing ? "console.log((\n" : ""), lifecycle.readSource, lifecycle.signal,
          limits) : undefined;
      return {
        ...(sourceLocation ? { sourceLocation } : {}),
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
