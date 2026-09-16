import type { CommandDefinition } from "../../contracts/command.js";
import type { VirtualShellPlugin } from "../../contracts/plugin.js";
import { onlyKeys, record } from "../../integrations/safejs/values.js";
import { UsageError } from "../internal.js";
import { createSafeJsCommands } from "../safejs/runtime.js";
import type { Invocation } from "../safejs/options.js";
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
  let index = 0;
  for (; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--") { index++; break; }
    if (argument === "-h" || argument === "--help") return { file: "-", args: [], print: false, help: true };
    if (argument === "--input-type" || argument.startsWith("--input-type=")) {
      const value = argument === "--input-type" ? args[++index] : argument.slice(13);
      if (value !== "module") throw new UsageError("SafeJS node supports only --input-type=module");
      continue;
    }
    const mode = argument === "--eval" || argument.startsWith("--eval=") || argument.startsWith("-e") ? "eval"
      : argument === "--print" || argument.startsWith("--print=") || argument.startsWith("-p") ? "print" : undefined;
    if (mode) {
      if (source !== undefined) throw new UsageError("conflicting source selectors");
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
  if (source !== undefined) return { source, file: print ? "<node -p>" : "<node -e>", args: args.slice(index), print, help: false };
  return { file: args[index] ?? "-", args: args.slice(index + 1), print: false, help: false };
}

export function createSafeJsNodeCommand<Budget>(options: NodeSafeJsCommandOptions<Budget>): CommandDefinition {
  const settings = record(options, "node options");
  onlyKeys(settings, ["runtime", "limits"]);
  if (settings.runtime === undefined || settings.runtime === null) throw new TypeError("node requires an injected SafeJS runtime");
  options = settings as unknown as NodeSafeJsCommandOptions<Budget>;
  const definitions = createSafeJsCommands(options, {
    name: "node",
    description: "Execute JavaScript with an injected SafeJS runtime and virtual I/O",
    help: "Usage: node [-e SOURCE | -p EXPRESSION | FILE | -] [ARG...]\nExecutes with the injected SafeJS interpreter; no native Node.js process.\nSupports --eval, --print, --input-type=module and -- before operands.\nNo source operand reads stdin. Files and inline source leave stdin for guest data.\nUse async imports from fs or require(\"node:fs/promises\").\nNative modules, synchronous fs and local module loading are not supported.\n",
    invocation,
    prepare(source, selected, modules) {
      const command = modules.command!;
      const stdio = modules.stdio!;
      const fs = modules.fs!;
      const processModule = {
        argv: ["/virtual/bin/node", ...(selected.source === undefined ? [selected.file] : []), ...selected.args],
        env: command.env,
        cwd: options.runtime.declareHostOperation(() => command.cwd, "read-side-effect"),
        exitCode: 0,
        stdin: { readText: stdio.readText, readBytes: stdio.readBytes },
        stdout: { write: stdio.write },
        stderr: { write: stdio.error },
      };
      modules.fs = { ...fs, default: fs };
      const requiredModules = new Map([["fs/promises", fs], ["node:fs/promises", fs]]);
      return {
        source: (selected.print ? `console.log((\n${source}\n));` : source) + "\n;__safeBashSetExitCode(process.exitCode);",
        bindings: {
          process: processModule, __safeBashSetExitCode: command.setExitCode,
          require: options.runtime.declareHostOperation((name: unknown) => {
            const module = typeof name === "string" ? requiredModules.get(name) : undefined;
            if (!module) throw new TypeError("Unsupported node module; use fs/promises or node:fs/promises");
            return module;
          }, "read-side-effect"),
        },
      };
    },
  });
  return Object.freeze(definitions[0]!);
}
