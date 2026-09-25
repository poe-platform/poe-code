import { resolvePath } from "../contracts/index.js";
import { ArrayOwner } from "./arrays/ledger.js";
import { IndexedBinding, valueToken } from "./arrays/bindings.js";
import { arrayStore, requireArrays, trackState } from "./arrays/state.js";
import type { InvocationScope } from "./cleanup.js";
import { functionDisplay } from "./display.js";
import { parseShell, type Command, type CapturedShellSyntax } from "./parser.js";
import type { Budget, State } from "./runtime.js";
import type {
  ShellSessionArraySnapshot,
  ShellSessionOptionsSnapshot,
  ShellSessionState,
} from "./types.js";

const cachedFunctionAsts = new WeakMap<ShellSessionState, ReadonlyMap<string, Command>>();

export function captureShellSessionState(state: State, exitCode: number): ShellSessionState {
  const store = arrayStore(state);
  const arrayNames = new Set<string>(store ? store.bindings.keys() : []);
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(state.variables)) {
    if (arrayNames.has(key)) continue;
    variables[key] = value;
  }

  const arrays: Record<string, ShellSessionArraySnapshot> = {};
  if (store) {
    for (const [name, { binding }] of store.bindings.entries()) {
      const elements: Record<string, string> = {};
      if (binding.associative) {
        for (const entry of binding.keys.values()) {
          const val = binding.values.get(entry.index);
          if (val !== undefined) {
            elements[entry.text.value] = val.text.value;
          }
        }
      } else {
        for (const [idx, val] of binding.values.entries()) {
          elements[String(idx)] = val.text.value;
        }
      }
      arrays[name] = {
        kind: binding.associative ? "associative" : "indexed",
        elements,
        assigned: binding.assigned,
      };
    }
  }

  const functions: Record<string, string> = {};
  const astMap = new Map<string, Command>();
  for (const [name, body] of state.functions.entries()) {
    functions[name] = functionDisplay(name, body);
    astMap.set(name, body);
  }

  const variableAttributes: Record<string, string> = {};
  if (state.variableAttributes) {
    for (const [name, attrs] of state.variableAttributes.entries()) {
      if (attrs) variableAttributes[name] = attrs;
    }
  }

  const options: ShellSessionOptionsSnapshot = {
    dotglob: Boolean(state.dotglob),
    globstar: Boolean(state.globstar),
    nullglob: Boolean(state.nullglob),
    nocaseglob: Boolean(state.nocaseglob),
    nocasematch: Boolean(state.nocasematch),
    extglob: Boolean((state as { extglob?: boolean }).extglob),
    braceexpand: state.braceexpand !== false,
    noglob: Boolean(state.noglob),
    noclobber: Boolean(state.noclobber),
    allexport: Boolean(state.allexport),
    noexec: Boolean(state.noexec),
    pipefail: Boolean(state.pipefail),
    errexit: Boolean(state.errexit),
    nounset: Boolean(state.nounset),
  };

  const snapshot: ShellSessionState = {
    cwd: state.cwd,
    umask: state.umask ?? 0o022,
    variables,
    exported: [...state.exported],
    readonlyVariables: state.readonlyVariables ? [...state.readonlyVariables] : [],
    variableAttributes,
    arrays,
    functions,
    exportedFunctions: state.exportedFunctions ? [...state.exportedFunctions] : [],
    readonlyFunctions: state.readonlyFunctions ? [...state.readonlyFunctions] : [],
    directoryStack: state.directoryStack ? [...state.directoryStack.entries] : [],
    options,
    status: exitCode,
  };
  cachedFunctionAsts.set(snapshot, astMap);
  return snapshot;
}

export async function restoreShellSessionState(
  state: State,
  snapshot: ShellSessionState,
  explicitOptions: { readonly cwd?: string | undefined; readonly env?: Readonly<Record<string, string>> | undefined },
  budget: Budget,
  scope: InvocationScope,
  syntax?: CapturedShellSyntax,
): Promise<State> {
  const resolvedCwd = explicitOptions.cwd !== undefined
    ? resolvePath("/", explicitOptions.cwd)
    : resolvePath("/", snapshot.cwd || "/");
  state.cwd = resolvedCwd;
  if (typeof snapshot.umask === "number") {
    state.umask = snapshot.umask & 0o777;
  }
  if (typeof snapshot.status === "number") {
    state.status = snapshot.status;
  }

  if (snapshot.variables) {
    for (const [name, value] of Object.entries(snapshot.variables)) {
      if (typeof value === "string") state.variables[name] = value;
    }
  }
  if (explicitOptions.env) {
    for (const [name, value] of Object.entries(explicitOptions.env)) {
      state.variables[name] = value;
      state.exported.add(name);
    }
  }
  state.variables.PWD = resolvedCwd;

  if (snapshot.exported) {
    for (const name of snapshot.exported) {
      state.exported.add(name);
    }
  }
  if (snapshot.readonlyVariables && snapshot.readonlyVariables.length > 0) {
    state.readonlyVariables ??= new Set();
    for (const name of snapshot.readonlyVariables) {
      state.readonlyVariables.add(name);
    }
  }
  if (snapshot.variableAttributes) {
    state.variableAttributes ??= new Map();
    for (const [name, attrs] of Object.entries(snapshot.variableAttributes)) {
      if (attrs) state.variableAttributes.set(name, attrs);
    }
  }

  const cachedAsts = cachedFunctionAsts.get(snapshot);
  if (snapshot.functions) {
    for (const [name, sourceText] of Object.entries(snapshot.functions)) {
      const cached = cachedAsts?.get(name);
      if (cached) {
        state.functions.set(name, cached);
        continue;
      }
      if (typeof sourceText === "string" && sourceText.trim().length > 0) {
        try {
          const parseOpts = Number.isFinite(budget.limits.maxParseUnits)
            ? { maxParseUnits: budget.limits.maxParseUnits }
            : {};
          const parsed = parseShell(sourceText, 0, parseOpts, syntax);
          const cmd = parsed.lists[0]?.pipelines[0]?.commands[0];
          if (cmd && cmd.kind === "function") {
            state.functions.set(name, cmd.body);
          }
        } catch {
          // Ignore malformed serialized function entries
        }
      }
    }
  }
  if (snapshot.exportedFunctions && snapshot.exportedFunctions.length > 0) {
    state.exportedFunctions ??= new Set();
    for (const name of snapshot.exportedFunctions) {
      state.exportedFunctions.add(name);
    }
  }
  if (snapshot.readonlyFunctions && snapshot.readonlyFunctions.length > 0) {
    state.readonlyFunctions ??= new Set();
    for (const name of snapshot.readonlyFunctions) {
      state.readonlyFunctions.add(name);
    }
  }

  if (snapshot.directoryStack && snapshot.directoryStack.length > 0) {
    const entries = [...snapshot.directoryStack];
    const bytes = entries.reduce((sum, entry) => sum + Buffer.byteLength(entry), 0);
    state.directoryStack = { entries, bytes };
  }

  if (snapshot.options) {
    const opts = snapshot.options;
    if (opts.dotglob !== undefined) state.dotglob = opts.dotglob;
    if (opts.globstar !== undefined) state.globstar = opts.globstar;
    if (opts.nullglob !== undefined) state.nullglob = opts.nullglob;
    if (opts.nocaseglob !== undefined) state.nocaseglob = opts.nocaseglob;
    if (opts.nocasematch !== undefined) state.nocasematch = opts.nocasematch;
    if (opts.extglob !== undefined) (state as { extglob?: boolean }).extglob = opts.extglob;
    if (opts.braceexpand !== undefined) state.braceexpand = opts.braceexpand;
    if (opts.noglob !== undefined) state.noglob = opts.noglob;
    if (opts.noclobber !== undefined) state.noclobber = opts.noclobber;
    if (opts.allexport !== undefined) state.allexport = opts.allexport;
    if (opts.noexec !== undefined) state.noexec = opts.noexec;
    if (opts.pipefail !== undefined) state.pipefail = opts.pipefail;
    if (opts.errexit !== undefined) state.errexit = opts.errexit;
    if (opts.nounset !== undefined) state.nounset = opts.nounset;
  }

  let tracked = state;
  if (snapshot.arrays && Object.keys(snapshot.arrays).length > 0) {
    tracked = trackState(state, budget, scope);
    const store = requireArrays(tracked);
    const operation = ArrayOwner.create(store.owner.ledger, store.owner);
    const holding = store.owner.hold();
    try {
      for (const [name, arr] of Object.entries(snapshot.arrays)) {
        delete tracked.variables[name];
        const isAssoc = arr.kind === "associative";
        const prepared = await store.prepareName(name, operation, budget.signal);
        const tickets = operation.reserve({ generation: true, version: true, epoch: true, work: 8 });
        const binding = IndexedBinding.create(store.owner, isAssoc);
        binding.assigned = arr.assigned !== false;
        if (isAssoc) {
          for (const [key, val] of Object.entries(arr.elements)) {
            const index = await binding.keyIndex(key, operation, budget.signal, true);
            if (index !== undefined) {
              const token = await valueToken(binding.owner, val, budget.signal);
              try {
                binding.insert(index, token);
              } catch (error) {
                token.release();
                throw error;
              }
            }
          }
        } else {
          for (const [idxStr, val] of Object.entries(arr.elements)) {
            const index = Number(idxStr);
            if (Number.isSafeInteger(index) && index >= 0) {
              const token = await valueToken(binding.owner, val, budget.signal);
              try {
                binding.insert(index, token);
              } catch (error) {
                token.release();
                throw error;
              }
            }
          }
        }
        await store.publish(name, binding, tickets, prepared);
      }
    } finally {
      try {
        await operation.close();
      } finally {
        holding.release();
      }
    }
  }
  return tracked;
}
