import type { CommandContext } from "../contracts/index.js";

/** Context copies share predicate identity without exposing the private resolver. */
export const variablePresence = new WeakMap<NonNullable<CommandContext["shellPredicates"]>, (name: string) => Promise<boolean>>();
