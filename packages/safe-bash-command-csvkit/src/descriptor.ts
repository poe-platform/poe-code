export interface ArgumentDescriptor {
  readonly optionStrings: readonly string[];
  readonly dest: string;
  readonly action: string;
  readonly nargs: number | string | null;
  readonly default: unknown;
  readonly const: unknown;
  readonly required: boolean;
  readonly type: string | null;
  readonly choices: readonly (string | number)[] | null;
  readonly metavar: string | readonly string[] | null;
  readonly help: string | null;
}

export interface CommandDescriptor {
  readonly name: string;
  readonly usage: string;
  readonly help: string;
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly actions: readonly ArgumentDescriptor[];
  readonly execute?: (runtime: import("./runtime.js").Runtime) => Promise<number>;
}

/** Defaults and command-specific overrides come from the same reference descriptors. */
export function commandDefaults(descriptor: CommandDescriptor, env: Readonly<Record<string, string>> = {}): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const action of descriptor.actions) {
    if (action.default !== "==SUPPRESS==") {
      const value = action.dest === "encoding" && action.default === "utf-8-sig" ? env.PYTHONIOENCODING ?? action.default : action.default;
      options[action.dest] = structuredClone(value);
    }
  }
  return Object.assign(options, structuredClone(descriptor.defaults));
}

/** Public descriptor metadata is immutable across invocations. */
export function freezeDescriptor<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) if (typeof child === "object" && child !== null && !Object.isFrozen(child)) freezeDescriptor(child);
  return Object.freeze(value);
}
