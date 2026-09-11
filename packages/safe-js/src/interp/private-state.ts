import type { SandboxClosure, SandboxValue } from "./values.js";

export type PrivateName = { readonly description: string };
export type PrivateElement =
  | { kind: "field"; value: SandboxValue }
  | { kind: "method"; value: SandboxClosure }
  | { kind: "accessor"; get?: SandboxClosure; set?: SandboxClosure };

export const privateElements = new WeakMap<object, Map<PrivateName, PrivateElement>>();

export function findPrivateElement(receiver: SandboxValue, name: PrivateName): PrivateElement | undefined {
  if (receiver === null || typeof receiver !== "object") throw new TypeError("Private elements require an object receiver.");
  return privateElements.get(receiver)?.get(name);
}

export function addPrivateElement(receiver: SandboxValue, name: PrivateName, element: PrivateElement): void {
  if (receiver === null || typeof receiver !== "object") throw new TypeError("Private elements require an object receiver.");
  let slots = privateElements.get(receiver);
  if (slots === undefined) {
    slots = new Map();
    privateElements.set(receiver, slots);
  }
  if (slots.has(name)) throw new TypeError(`Private element #${name.description} is already installed.`);
  slots.set(name, element);
}
