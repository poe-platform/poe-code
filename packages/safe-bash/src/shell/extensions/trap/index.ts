import { constants, platform } from "node:os";
import type { ShellExtension, ShellExtensionContext, ShellExtensionInstance, ShellExtensionOption, ShellExtensionScope } from "../../extensions.js";
import { shellValueByteLength, shellValueBytes, shellValueText, type ShellValue } from "../../../contracts/value.js";
import { commandRuntimeIdentity } from "../../../contracts/command.js";

export interface TrapSignalHost {
  subscribe(deliver: (signal: string | number) => boolean, scope: object): () => void | Promise<void>;
}

export interface TrapExtensionOptions {
  readonly signalNames?: Readonly<Record<string, number>>;
  readonly signalHost?: TrapSignalHost;
}

interface Action { readonly source: ShellValue; readonly active: boolean }

function quote(source: ShellValue): Uint8Array {
  const bytes = shellValueBytes(source);
  const parts: Uint8Array[] = [Buffer.from("'")];
  let start = 0;
  for (let index = 0; index < bytes.length; index++) if (bytes[index] === 39) {
    parts.push(bytes.subarray(start, index), Buffer.from("'\\''"));
    start = index + 1;
  }
  parts.push(bytes.subarray(start), Buffer.from("'"));
  return Buffer.concat(parts);
}

export function trapExtension(configuration: TrapExtensionOptions = {}): ShellExtension {
  const catalog = { ...(configuration.signalNames ?? { ...constants.signals, ...(platform() === "darwin" ? { SIGEMT: 7 } : {}) }) };
  const names = new Map<number, string>([[0, "EXIT"]]);
  const aliases = new Map<string, number>([["EXIT", 0], ["SIGEXIT", 0]]);
  for (const [name, number] of Object.entries(catalog)) {
    if (!name.startsWith("SIG") || !Number.isSafeInteger(number) || number <= 0 || number > 1024) throw new TypeError("Invalid trap signal catalog");
    if (!names.has(number)) names.set(number, name);
    aliases.set(name, number);
    aliases.set(name.slice(3), number);
  }
  const pseudoBase = Math.max(...names.keys()) + 1;
  for (const [index, name] of ["DEBUG", "ERR", "RETURN"].entries()) { names.set(pseudoBase + index, name); aliases.set(name, pseudoBase + index); aliases.set("SIG" + name, pseudoBase + index); }
  const resolve = (value: string | number): number | undefined => {
    const text = String(value).toUpperCase();
    const named = aliases.get(text);
    if (named !== undefined) return named;
    const digits = text[0] === "+" ? text.slice(1) : text;
    if (!digits || [...digits].some(character => character < "0" || character > "9")) return undefined;
    const number = Number(digits);
    return names.has(number) ? number : undefined;
  };

  function instance(actions = new Map<number, Action>(), errorTrace = false, functionTrace = false, inheritedIgnored: ReadonlySet<number> = new Set(), extendedDebug = false): ShellExtensionInstance {
    const options: ShellExtensionOption[] = [{ name: "errtrace", flag: "E", enabled: errorTrace }, { name: "functrace", flag: "T", enabled: functionTrace }];
    const running = new Set<number>();
    const pending = new Set<number>();
    const functions: Map<number, Action>[] = [];
    const sources: (Action | undefined)[] = [];
    const run = async (number: number, context: ShellExtensionContext): Promise<number | undefined> => {
      context.signal.throwIfAborted();
      const action = actions.get(number);
      if (!action?.active || !shellValueByteLength(action.source) || running.has(number)) return;
      running.add(number);
      try { return await context.evaluate(action.source, { name: number === 0 ? "exit trap" : "trap" }); }
      finally { running.delete(number); }
    };
    return {
      options,
      shoptOptions: [{ name: "extdebug", get enabled() { return extendedDebug; }, set enabled(value) { extendedDebug = value; for (const option of options) option.enabled = value; } }],
      start(context) {
        if (!configuration.signalHost) return;
        let open = true;
        const subscription: { close?: () => void | Promise<void> } = {};
        context.registerCleanup(async () => { open = false; pending.clear(); await subscription.close?.(); });
        subscription.close = configuration.signalHost.subscribe(signal => {
          if (!open || context.signal.aborted) return false;
          const number = resolve(signal);
          if (number === undefined || number === 0 || number >= pseudoBase || names.get(number) === "SIGKILL" || names.get(number) === "SIGSTOP") return false;
          const action = actions.get(number);
          if (!action?.active) return false;
          if (shellValueByteLength(action.source)) {
            pending.add(number);
            context.interruptWait?.((128 + number) % 256);
          }
          return true;
        }, context.scope);
      },
      builtins: [{
        name: "trap", special: true,
        async execute(context) {
          context.signal.throwIfAborted();
          const args = [...context.args];
          let print = false, list = false;
          while (args[0]?.startsWith("-") && args[0] !== "-") {
            const option = args.shift()!;
            if (option === "--") break;
            for (const flag of option.slice(1)) {
              if (flag === "p") print = true;
              else if (flag === "l") list = true;
              else { await context.stderr.write(new TextEncoder().encode(`trap: -${flag}: invalid option\ntrap: usage: trap [-lp] [arg signal_spec ...]\n`)); return 2; }
            }
          }
          if (list) {
            const signals = [...names].filter(([number]) => number > 0 && number < pseudoBase).sort(([left], [right]) => left - right);
            let output = "";
            for (const [index, [number, name]] of signals.entries()) output += `${String(number).padStart(2, " ")}) ${name}${index % 4 === 3 ? "\n" : "\t"}`;
            if (!output.endsWith("\n")) output += "\n";
            await context.stdout.write(new TextEncoder().encode(output));
            return 0;
          }
          if (!args.length) print = true;
          let action: ShellValue | undefined;
          const first = args[0];
          const numericReset = !!first && [...first].every(character => character >= "0" && character <= "9");
          if (!print && args.length > 1 && !numericReset) { action = context.argumentValues[context.args.length - args.length]; args.shift(); }
          if (!print && args.length === 1 && args[0] === "-") { await context.stderr.write(new TextEncoder().encode("trap: usage: trap [-lp] [arg signal_spec ...]\n")); return 2; }
          if (action !== undefined && shellValueText(action) !== "-") context.accountSource(action);
          const targets = args.length ? args : [...actions.keys()].sort((left, right) => left - right).map(String);
          let status = 0;
          for (const target of targets) {
            const number = resolve(target);
            if (number === undefined) { await context.diagnostic(`trap: ${target}: invalid signal specification`); status = 1; continue; }
            if (print) {
              const current = actions.get(number);
              if (current) await context.stdout.write(Buffer.concat([Buffer.from("trap -- "), quote(current.source), Buffer.from(` ${names.get(number)}\n`)]));
            } else if (inheritedIgnored.has(number)) continue;
            else if (action === undefined || shellValueText(action) === "-") actions.delete(number);
            else actions.set(number, { source: action, active: true });
          }
          return status;
        },
      }],
      fork(scope: ShellExtensionScope) {
        const inherited = new Map<number, Action>();
        for (const [number, action] of actions) {
          if (scope === "process") { if (number > 0 && number < pseudoBase && !shellValueByteLength(action.source)) inherited.set(number, action); }
          else inherited.set(number, { source: action.source, active: !shellValueByteLength(action.source) || names.get(number) === "ERR" && options[0]!.enabled || ["DEBUG", "RETURN"].includes(names.get(number)!) && options[1]!.enabled });
        }
        return instance(inherited, scope !== "process" && options[0]!.enabled, scope !== "process" && options[1]!.enabled, scope === "process" ? new Set(inherited.keys()) : inheritedIgnored, scope !== "process" && extendedDebug);
      },
      async event(event, context) {
        if (event === "function-enter") { functions.push(new Map(actions)); return; }
        if (event === "function-leave") { functions.pop(); return; }
        if (event === "source-enter") { sources.push(actions.get(aliases.get("DEBUG")!)); return; }
        if (event === "source-leave") {
          const previous = sources.pop();
          if (previous && !actions.has(aliases.get("DEBUG")!)) actions.set(aliases.get("DEBUG")!, previous);
          return;
        }
        for (const number of pending) {
          if (running.has(number)) continue;
          pending.delete(number);
          await run(number, context);
        }
        const name = event === "exit" ? "EXIT" : event === "error" ? "ERR" : event === "command" ? "DEBUG" : "RETURN";
        if (name === "DEBUG" && context.sourceDepth > 0 && sources.at(-1) === actions.get(aliases.get(name)!) && !options[1]!.enabled) return;
        const inherited = functions.at(-1)?.get(aliases.get(name)!) === actions.get(aliases.get(name)!);
        if (context.functionDepth > 0 && inherited && (name === "ERR" && !options[0]!.enabled || (name === "DEBUG" || name === "RETURN") && !options[1]!.enabled)) return;
        const status = await run(aliases.get(name)!, context);
        if (name === "DEBUG" && extendedDebug && status) return status === 2 && (context.functionDepth > 0 || context.sourceDepth > 0) ? { action: "return", status } : { action: "skip" };
      },
    };
  }

  return { name: "trap", runtimeIdentity: commandRuntimeIdentity, create: () => instance() };
}
