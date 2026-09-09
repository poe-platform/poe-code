import { createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject, type SandboxPrimitive, type SandboxValue } from "./values.js";
import type { Budget } from "./budget.js";
import { retainValues } from "./resources.js";

type ProxyObject = Exclude<SandboxValue, SandboxPrimitive>;
type ProxyState = { target: ProxyObject | null; handler: ProxyObject | null };

export const guestProxyStates = new WeakMap<object, ProxyState>();

export function createGuestProxy(target: SandboxValue, handler: SandboxValue): SandboxObject | SandboxClosure {
  if (typeof target !== "object" || target === null) throw new TypeError("Proxy target must be an object.");
  if (typeof handler !== "object" || handler === null) throw new TypeError("Proxy handler must be an object.");
  const proxy = isSandboxClosure(target)
    ? createSandboxClosure({ guest: true, sandbox: true,
      call: () => { throw new TypeError("Proxy calls require runtime dispatch."); },
      ...(target.construct === undefined ? {} : {
        construct: () => { throw new TypeError("Proxy construction requires runtime dispatch."); }
      })
    })
    : Object.create(null) as SandboxObject;
  guestProxyStates.set(proxy, { target, handler });
  return proxy;
}

export function requireActiveGuestProxy(proxy: object): { target: ProxyObject; handler: ProxyObject } {
  const state = guestProxyStates.get(proxy);
  if (state === undefined) throw new TypeError("Incompatible proxy receiver.");
  if (state.target === null || state.handler === null) throw new TypeError("Cannot operate on a revoked proxy.");
  return state as { target: ProxyObject; handler: ProxyObject };
}

export function revokeGuestProxy(proxy: object): void {
  const state = guestProxyStates.get(proxy);
  if (state === undefined) throw new TypeError("Incompatible proxy receiver.");
  state.target = null;
  state.handler = null;
}

export async function withGuestProxyTrap<Result>(
  proxy: object,
  name: string,
  budget: Budget,
  context: SandboxCallContext | undefined,
  operation: (state: { target: ProxyObject; handler: ProxyObject; trap: SandboxClosure | undefined }) => Result | Promise<Result>
): Promise<Result> {
  const { target, handler } = requireActiveGuestProxy(proxy);
  if (context?.getProperty === undefined) throw new TypeError("Proxy operations require guest property access.");
  let trap: SandboxClosure | undefined;
  const release = retainValues(budget, () => [target, handler, trap]);
  try {
    const method = await context.getProperty(handler, name);
    if (method !== undefined && method !== null) {
      if (!isSandboxClosure(method)) throw new TypeError(`Proxy trap '${name}' is not callable.`);
      trap = method;
    }
    return await operation({ target, handler, trap });
  } finally {
    release();
  }
}
