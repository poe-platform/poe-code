import type { Budget } from "./budget.js";
import type { SandboxValue } from "./values.js";
import { guestProxyStates, requireActiveGuestProxy } from "./guest-proxy.js";

export function sandboxIsArray(value: SandboxValue, budget: Budget): boolean {
  while (typeof value === "object" && value !== null && guestProxyStates.has(value)) {
    budget.visitNode();
    value = requireActiveGuestProxy(value).target;
  }
  return Array.isArray(value);
}
