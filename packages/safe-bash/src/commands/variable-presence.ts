import type { CommandContext } from "../contracts/index.js";

const variablePresenceSymbol = Symbol("safe-bash.variablePresence");
const fallbackPresence = new WeakMap<NonNullable<CommandContext["shellPredicates"]>, (name: string) => Promise<boolean>>();

/** Context copies share predicate identity without exposing the private resolver. */
export const variablePresence = {
  get(key: NonNullable<CommandContext["shellPredicates"]>): ((name: string) => Promise<boolean>) | undefined {
    return (key as unknown as Record<symbol, ((name: string) => Promise<boolean>) | undefined>)[variablePresenceSymbol] ?? fallbackPresence.get(key);
  },
  set(key: NonNullable<CommandContext["shellPredicates"]>, value: (name: string) => Promise<boolean>): void {
    if (Object.isExtensible(key)) {
      (key as unknown as Record<symbol, (name: string) => Promise<boolean>>)[variablePresenceSymbol] = value;
    } else {
      fallbackPresence.set(key, value);
    }
  },
};
