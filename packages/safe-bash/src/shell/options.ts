import type { State } from "./runtime.js";

export function shellOptions(state: State, setNamespace: boolean): Map<string, { enabled: boolean }> {
  const options = new Map<string, { enabled: boolean }>();
  for (const name of setNamespace ? ["allexport", "braceexpand", "errexit", "hashall", "noclobber", "noexec", "noglob", "nounset", "physical", "pipefail"] as const : ["cdable_vars", "checkhash", "dotglob", "expand_aliases", "extglob", "failglob", "globskipdots", "globstar", "inherit_errexit", "lastpipe", "nocaseglob", "nocasematch", "nullglob", "patsub_replacement", "shift_verbose", "sourcepath", "varredir_close", "xpg_echo"] as const) {
    options.set(name, {
      get enabled() { return name === "braceexpand" || name === "hashall" || name === "globskipdots" || name === "patsub_replacement" || name === "sourcepath" ? state[name] !== false : !!state[name]; },
      set enabled(value) { state[name] = value; },
    });
  }
  for (const [name, option] of (setNamespace ? state.extensions?.options : state.extensions?.shoptOptions) ?? []) options.set(name, option);
  return options;
}

export function installOptionVariables(state: State): void {
  for (const name of ["SHELLOPTS", "BASHOPTS"]) {
    Object.defineProperty(state.variables, name, {
      configurable: true,
      enumerable: true,
      get: () => [...shellOptions(state, name === "SHELLOPTS")]
        .filter(([, option]) => option.enabled)
        .map(([option]) => option)
        .sort()
        .join(":"),
    });
    (state.readonlyVariables ??= new Set()).add(name);
  }
}
